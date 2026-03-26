import { randomUUID } from "crypto";
import { getAskmoreV2Repository } from "@/server/askmore_v2/repo";
import { toCanonicalFlowDefinition } from "@/server/askmore_v2/flow-definition";
import { runAnswerQuestionAgent } from "@/server/askmore_v2/agents/answer-question-agent";
import { runHelpAgent } from "@/server/askmore_v2/agents/help-agent";
import { runClarificationAgent } from "@/server/askmore_v2/agents/clarification-agent";
import { runDiscussionAgent } from "@/server/askmore_v2/agents/discussion-agent";
import { buildRuntimeContextSnapshot, ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";
import { expirePendingCommitments } from "@/server/askmore_v2/runtime/pending-commitments";
import { routeIntent } from "@/server/askmore_v2/runtime/intent-router";
import { logAskmoreRuntime } from "@/server/askmore_v2/runtime/runtime-logger";
import { composeAssistantMessageFromEvents, eventsToResponseBlocks } from "@/server/askmore_v2/events/event-builder";
import { buildVisibleEvents } from "@/server/askmore_v2/presentation/visible-response-director";
import { dbQuery, getPool } from "@/server/repo/db";
import {
  AskmoreV2FlowQuestion,
  AskmoreV2ChoiceKind,
  AskmoreV2InternalEvent,
  AskmoreV2Language,
  AskmoreV2PhaseProgressCallback,
  AskmoreV2RuntimePhase,
  AskmoreV2Session,
  AskmoreV2TurnEvent,
  AskmoreV2TurnChoiceInput,
  AskmoreV2TurnResult,
} from "@/server/askmore_v2/types";

interface SessionRunInput {
  sessionId: string;
  userMessage: string;
  language: AskmoreV2Language;
  clientTurnId: string;
  choice?: AskmoreV2TurnChoiceInput;
  onPhaseProgress?: AskmoreV2PhaseProgressCallback;
}

export class SessionRun {
  constructor(private readonly input: SessionRunInput) {}

  private phaseLabel(
    phase: AskmoreV2RuntimePhase,
    language: AskmoreV2Language,
    intent?: "answer_question" | "ask_for_help" | "clarify_meaning" | "other_discussion",
  ): string {
    const isZh = language === "zh";
    if (phase === "assemble_context") {
      return isZh ? "正在整理你刚刚提供的信息" : "Understanding your latest input";
    }
    if (phase === "route_intent") {
      return isZh ? "正在判断你现在最需要的帮助方式" : "Deciding the best response mode";
    }
    if (phase === "execute_task") {
      if (intent === "ask_for_help") {
        return isZh ? "正在识别你的卡点并给出可用帮助" : "Identifying where you are stuck and building help";
      }
      if (intent === "clarify_meaning") {
        return isZh ? "正在定位歧义并做关键确认" : "Pinpointing ambiguity and aligning key meaning";
      }
      if (intent === "other_discussion") {
        return isZh ? "正在提炼背景信息并拉回主线" : "Extracting useful context and returning to the main track";
      }
      return isZh ? "正在提取有效回答并更新进度" : "Extracting useful answers and updating progress";
    }
    if (phase === "build_response") {
      return isZh ? "正在组织清晰、自然的回复" : "Composing a clear and natural response";
    }
    return isZh ? "正在保存结果并完成这一轮" : "Saving this turn and finalizing";
  }

  private emitPhase(
    phase: AskmoreV2RuntimePhase,
    status: "start" | "done",
    intent?: "answer_question" | "ask_for_help" | "clarify_meaning" | "other_discussion",
  ): void {
    if (!this.input.onPhaseProgress) return;
    try {
      this.input.onPhaseProgress({
        phase,
        status,
        label: this.phaseLabel(phase, this.input.language, intent),
      });
    } catch {
      // phase hook failures should not affect turn execution
    }
  }

  private ensureTurnResultShape(result: AskmoreV2TurnResult): AskmoreV2TurnResult {
    return {
      ...result,
      events: Array.isArray(result.events) ? result.events : [],
      debug_events: Array.isArray(result.debug_events) ? result.debug_events : [],
      response_blocks: Array.isArray(result.response_blocks) ? result.response_blocks : [],
    };
  }

  private async acquireSessionLock(): Promise<void> {
    if (!getPool()) return;
    await dbQuery("select pg_advisory_xact_lock(hashtext($1))", [this.input.sessionId]);
  }

  private async dispatchTask(params: {
    session: AskmoreV2Session;
    flow: {
      scenario: string;
      target_output_type: string;
      questions: AskmoreV2FlowQuestion[];
    };
    sessionId: string;
    userMessage: string;
    language: AskmoreV2Language;
    choice?: AskmoreV2TurnChoiceInput;
    context: ReturnType<typeof buildRuntimeContextSnapshot>;
    intent: "answer_question" | "ask_for_help" | "clarify_meaning" | "other_discussion";
  }) {
    if (params.intent === "ask_for_help") {
      return runHelpAgent(params);
    }
    if (params.intent === "clarify_meaning") {
      return runClarificationAgent(params);
    }
    if (params.intent === "other_discussion") {
      return runDiscussionAgent(params);
    }
    return runAnswerQuestionAgent(params);
  }

  private normalizeInternalEvents(events: AskmoreV2InternalEvent[], fallbackCreatedAt: string): AskmoreV2InternalEvent[] {
    return events.map((event) => ({
      ...event,
      event_id: event.event_id || randomUUID(),
      created_at: event.created_at || fallbackCreatedAt,
      visible: event.visible !== false,
      payload: event.payload ?? {},
    }));
  }

  private normalizeChoice(choice?: AskmoreV2TurnChoiceInput): AskmoreV2TurnChoiceInput | undefined {
    if (!choice) return undefined;
    const normalized: AskmoreV2TurnChoiceInput = {
      ...choice,
      choice_kind: choice.choice_kind ?? "micro_confirm",
    };
    if (!choice.choice_kind) {
      logAskmoreRuntime("choice_kind_compat_defaulted", {
        session_id: this.input.sessionId,
        source_event_id: choice.source_event_id ?? null,
        defaulted_choice_kind: "micro_confirm",
      });
    }
    return normalized;
  }

  private resolveExpectedChoiceKind(event: AskmoreV2TurnEvent): AskmoreV2ChoiceKind | null {
    if (event.event_type === "micro_confirm") return "micro_confirm";
    if (event.event_type !== "next_step") return null;
    const optionsCount = (event.payload?.options ?? []).length;
    const mode = event.payload?.mode;
    if (mode === "follow_up_select" || optionsCount > 0) return "follow_up_select";
    return null;
  }

  private async validateChoiceInput(params: {
    repo: ReturnType<typeof getAskmoreV2Repository>;
    choice?: AskmoreV2TurnChoiceInput;
  }): Promise<AskmoreV2TurnChoiceInput | undefined> {
    const choice = this.normalizeChoice(params.choice);
    if (!choice) return undefined;
    if (!choice.source_event_id) {
      logAskmoreRuntime("choice_source_event_missing", {
        session_id: this.input.sessionId,
        choice_kind: choice.choice_kind ?? null,
        dimension_id: choice.dimension_id,
      });
      return choice;
    }

    const sourceEvent = await params.repo.getTurnEventById(this.input.sessionId, choice.source_event_id, "visible");
    if (!sourceEvent) {
      throw new Error("Invalid choice source_event_id");
    }

    const expectedKind = this.resolveExpectedChoiceKind(sourceEvent);
    if (!expectedKind) {
      throw new Error("Choice source event is not selectable");
    }
    if (choice.choice_kind !== expectedKind) {
      throw new Error(`choice_kind mismatch: expected ${expectedKind}`);
    }

    const sourceDimensionId = sourceEvent.payload?.dimension_id;
    if (sourceDimensionId && choice.dimension_id !== sourceDimensionId) {
      throw new Error("choice dimension does not match source event");
    }
    const sourceOptions = sourceEvent.payload?.options ?? [];
    if (sourceOptions.length > 0 && !sourceOptions.some((item) => item.option_id === choice.option_id)) {
      throw new Error("choice option is not allowed for source event");
    }

    return choice;
  }

  private assertMicroConfirmOwnership(taskModule: string, events: AskmoreV2InternalEvent[]): void {
    if (taskModule === "ClarificationAgent") return;
    const hasMicroConfirm = events.some((event) => event.event_type === "micro_confirm");
    if (hasMicroConfirm) {
      throw new Error("ASKMORE_V2_EVENT_OWNERSHIP_VIOLATION: micro_confirm must be emitted by ClarificationAgent");
    }
  }

  async executeTurn(): Promise<AskmoreV2TurnResult> {
    const repo = getAskmoreV2Repository();
    logAskmoreRuntime("turn_start", {
      session_id: this.input.sessionId,
      client_turn_id: this.input.clientTurnId,
      language: this.input.language,
      has_choice: Boolean(this.input.choice),
      user_message: this.input.userMessage,
    });
    try {
      await this.acquireSessionLock();
      logAskmoreRuntime("session_lock_acquired", {
        session_id: this.input.sessionId,
      });

      const now = new Date().toISOString();
      const committed = await repo.getTurnCommit(this.input.sessionId, this.input.clientTurnId);
      if (committed) {
        logAskmoreRuntime("turn_idempotent_replay", {
          session_id: this.input.sessionId,
          client_turn_id: this.input.clientTurnId,
          turn_id: committed.turn_id,
        });
        return this.ensureTurnResultShape(committed.response_jsonb);
      }
      this.emitPhase("assemble_context", "start");

      const session = await repo.getSession(this.input.sessionId);
      if (!session) {
        throw new Error("Session not found");
      }
      ensureRuntimeStateDefaults(session.state_jsonb);
      const expiredCommitments = expirePendingCommitments({
        state: session.state_jsonb,
        now,
        turnIndex: session.turn_count + 1,
        activeQuestionId: session.state_jsonb.session.current_question_id,
      });

      const flow = await repo.getFlowVersion(session.flow_version_id);
      if (!flow) {
        throw new Error("Flow version not found");
      }
      const canonicalFlow = toCanonicalFlowDefinition(flow.flow_jsonb);
      const questions = canonicalFlow.final_flow_questions;
      const recentMessages = await repo.listMessages(this.input.sessionId, 60);

      const context = buildRuntimeContextSnapshot({
        session,
        questions,
        userMessage: this.input.userMessage,
        recentMessages,
      });
      const normalizedChoice = await this.validateChoiceInput({
        repo,
        choice: this.input.choice,
      });
      logAskmoreRuntime("context_built", {
        session_id: this.input.sessionId,
        active_question_id: context.active_question.question_id,
        unresolved_gaps: context.unresolved_gaps.map((item) => ({
          dimension_id: item.dimension_id,
          severity: item.severity,
          actionable: item.actionable,
        })),
        pending_commitments: context.pending_commitments.length,
        recent_memory_size: context.recent_memory.message_snippets.length,
        expired_commitments: expiredCommitments.length,
      });
      this.emitPhase("assemble_context", "done");

      this.emitPhase("route_intent", "start");
      const routedIntent = await routeIntent({
        userMessage: this.input.userMessage,
        context,
        choice: normalizedChoice,
      });
      logAskmoreRuntime("intent_routed", {
        session_id: this.input.sessionId,
        turn_intent: routedIntent.intent,
        confidence: routedIntent.confidence,
        rationale: routedIntent.rationale ?? null,
      });
      this.emitPhase("route_intent", "done");

      this.emitPhase("execute_task", "start", routedIntent.intent);
      let task = await this.dispatchTask({
        session,
        flow: {
          scenario: canonicalFlow.scenario,
          target_output_type: canonicalFlow.target_output_type,
          questions,
        },
        sessionId: this.input.sessionId,
        userMessage: this.input.userMessage,
        language: this.input.language,
        choice: normalizedChoice,
        context,
        intent: routedIntent.intent,
      });
      logAskmoreRuntime("task_executed", {
        session_id: this.input.sessionId,
        task_module: task.task_module,
        turn_count: task.turn_count,
        status: task.status,
        transition_reason: task.transition_reason ?? null,
        next_question: task.next_question?.question_id ?? null,
        events: task.events.map((event) => event.event_type),
        handoff_intent: task.handoff_intent ?? null,
      });

      if (task.handoff_intent) {
        logAskmoreRuntime("task_handoff_requested", {
          session_id: this.input.sessionId,
          from_module: task.task_module,
          to_intent: task.handoff_intent,
          reason: task.transition_reason ?? null,
        });

        const handoffSession: AskmoreV2Session = {
          ...session,
          state_jsonb: task.state,
          status: task.status,
          // Keep one-turn accounting stable: handoff still belongs to the same runtime turn.
          turn_count: session.turn_count,
        };
        const handoffContext = buildRuntimeContextSnapshot({
          session: handoffSession,
          questions,
          userMessage: this.input.userMessage,
          recentMessages,
        });
        const handoffTask = await this.dispatchTask({
          session: handoffSession,
          flow: {
            scenario: canonicalFlow.scenario,
            target_output_type: canonicalFlow.target_output_type,
            questions,
          },
          sessionId: this.input.sessionId,
          userMessage: this.input.userMessage,
          language: this.input.language,
          choice: normalizedChoice,
          context: handoffContext,
          intent: task.handoff_intent,
        });
        logAskmoreRuntime("task_handoff_executed", {
          session_id: this.input.sessionId,
          task_module: handoffTask.task_module,
          turn_count: handoffTask.turn_count,
          status: handoffTask.status,
          transition_reason: handoffTask.transition_reason ?? null,
          events: handoffTask.events.map((event) => event.event_type),
        });

        task = {
          ...handoffTask,
          events: [...task.events, ...handoffTask.events],
          transition_reason: handoffTask.transition_reason ?? task.transition_reason,
        };
      }
      this.emitPhase("execute_task", "done", routedIntent.intent);

      this.assertMicroConfirmOwnership(task.task_module, task.events);

      this.emitPhase("build_response", "start", routedIntent.intent);
      const turnId = randomUUID();
      const normalizedDebugEvents = this.normalizeInternalEvents(task.events, now);
      const visibleEvents = await buildVisibleEvents({
        debugEvents: normalizedDebugEvents,
        routedIntent,
        state: task.state,
        language: this.input.language,
        scenario: canonicalFlow.scenario,
        targetOutputType: canonicalFlow.target_output_type,
        latestUserTurn: this.input.userMessage,
      });
      const responseBlocks = eventsToResponseBlocks(visibleEvents);
      const assistantMessage =
        composeAssistantMessageFromEvents(visibleEvents)
        || (this.input.language === "zh" ? "我先接住你刚刚的输入。" : "I got your latest turn.");
      const nextQuestion =
        task.next_question
        ?? (() => {
          const next = visibleEvents.find((event) => event.event_type === "next_step")?.payload.content;
          if (!next) return null;
          return {
        question_id: task.state.session.current_question_id,
        question_text: next,
      };
    })();
      this.emitPhase("build_response", "done", routedIntent.intent);

      const result: AskmoreV2TurnResult = {
        session_id: this.input.sessionId,
        turn_id: turnId,
        state: task.state,
        routed_intent: routedIntent,
        events: visibleEvents,
        debug_events: normalizedDebugEvents,
        response_blocks: responseBlocks,
        next_question: nextQuestion ?? null,
      };

      this.emitPhase("persist_and_finalize", "start", routedIntent.intent);
      result.state.session.pending_intent = result.state.session.pending_intent ?? routedIntent.intent;
      result.state.session.active_turn_index = task.turn_count;
      result.state.runtime_meta = {
        ...(result.state.runtime_meta ?? {}),
        last_task_module: task.task_module,
        last_transition_reason:
          expiredCommitments.length > 0
            ? `${task.transition_reason ?? routedIntent.rationale ?? "turn_completed"}|expired_commitments=${expiredCommitments.length}`
            : task.transition_reason ?? routedIntent.rationale ?? undefined,
        latest_visible_summary:
          result.events.find((event) => event.event_type === "understanding" || event.event_type === "acknowledgement")?.payload.content
          ?? result.events.find((event) => event.event_type === "transition")?.payload.content
          ?? undefined,
      };
      session.state_jsonb = result.state;
      session.status = task.status;
      session.turn_count = task.turn_count;
      session.updated_at = now;
      await repo.updateSession(session);
      logAskmoreRuntime("session_updated", {
        session_id: this.input.sessionId,
        status: session.status,
        turn_count: session.turn_count,
        pending_commitments: session.state_jsonb.session.pending_commitments?.length ?? 0,
        last_task_module: session.state_jsonb.runtime_meta?.last_task_module ?? null,
        last_transition_reason: session.state_jsonb.runtime_meta?.last_transition_reason ?? null,
      });

      if (!task.messages_already_persisted) {
        await repo.addMessage({
          id: randomUUID(),
          session_id: this.input.sessionId,
          role: "user",
          message_text: this.input.userMessage,
          created_at: now,
        });
        await repo.addMessage({
          id: randomUUID(),
          session_id: this.input.sessionId,
          role: "assistant",
          message_text: assistantMessage,
          created_at: now,
        });
        logAskmoreRuntime("messages_persisted", {
          session_id: this.input.sessionId,
          persisted_user_and_assistant: true,
        });
      }

      await repo.addTurnEvents({
        session_id: this.input.sessionId,
        turn_id: turnId,
        channel: "internal",
        events: result.debug_events,
      });
      await repo.addTurnEvents({
        session_id: this.input.sessionId,
        turn_id: turnId,
        channel: "visible",
        events: result.events,
      });
      logAskmoreRuntime("events_persisted", {
        session_id: this.input.sessionId,
        turn_id: turnId,
        visible_event_count: result.events.length,
        visible_event_types: result.events.map((event) => event.event_type),
        debug_event_count: result.debug_events.length,
        debug_event_types: result.debug_events.map((event) => event.event_type),
      });

      try {
        await repo.createTurnCommit({
          session_id: this.input.sessionId,
          client_turn_id: this.input.clientTurnId,
          turn_id: turnId,
          response_jsonb: result,
          created_at: now,
        });
        logAskmoreRuntime("turn_commit_saved", {
          session_id: this.input.sessionId,
          client_turn_id: this.input.clientTurnId,
          turn_id: turnId,
        });
      } catch {
        const existing = await repo.getTurnCommit(this.input.sessionId, this.input.clientTurnId);
        if (existing) {
          logAskmoreRuntime("turn_commit_conflict_replay", {
            session_id: this.input.sessionId,
            client_turn_id: this.input.clientTurnId,
            turn_id: existing.turn_id,
          });
          this.emitPhase("persist_and_finalize", "done", routedIntent.intent);
          return this.ensureTurnResultShape(existing.response_jsonb);
        }
        throw new Error("Failed to persist turn commit");
      }

      logAskmoreRuntime("turn_end", {
        session_id: this.input.sessionId,
        turn_id: turnId,
        intent: result.routed_intent.intent,
        task_module: result.state.runtime_meta?.last_task_module ?? null,
        question_id: result.state.session.current_question_id,
      });
      this.emitPhase("persist_and_finalize", "done", routedIntent.intent);

      return this.ensureTurnResultShape(result);
    } catch (error) {
      logAskmoreRuntime("turn_failed", {
        session_id: this.input.sessionId,
        client_turn_id: this.input.clientTurnId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
