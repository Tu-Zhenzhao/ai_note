import {
  AgentTurnResult,
  InteractionModule,
  InterviewMessage,
  InterviewState,
  TaskType,
  ToolActionLog,
} from "@/lib/types";
import { classifyTurn } from "@/server/agent/planner";
import { runAnswerQuestionTask } from "@/server/agent/tasks/answer-question";
import { runDiscussionTask } from "@/server/agent/tasks/discussion";
import { runHelpAboutQuestionTask } from "@/server/agent/tasks/help-about-question";
import { getLastModelRoute } from "@/server/model/adapters";
import { getInterviewRepository } from "@/server/repo";
import { createDefaultChecklist } from "@/server/rules/checklist";
import { evaluateCompletion } from "@/server/rules/completion";
import { composePreview } from "@/server/services/preview";
import { syncWorkflowState } from "@/server/services/workflow";
import { runStep, traceRunEnd, traceRunStart, toErrorSummary } from "@/server/tools/runtime-trace";

function migrateStateIfNeeded(state: InterviewState): void {
  if (state.conversation_meta.current_section_index == null) {
    state.conversation_meta.current_section_index = 0;
  }
  if (state.conversation_meta.current_section_turn_count == null) {
    state.conversation_meta.current_section_turn_count = 0;
  }
  if (!state.checklist || state.checklist.length === 0) {
    state.checklist = createDefaultChecklist();
  }
  if (!Array.isArray(state.system_assessment.preview_slots)) {
    state.system_assessment.preview_slots = [];
  }
  if (!state.workflow) {
    state.workflow = {
      phase: "interviewing",
      active_section_id: "company_understanding",
      pending_review_section_id: null,
      pending_confirmation_slot_id: null,
      pending_interaction_module: null,
      next_question_slot_id: null,
      required_open_slot_ids: [],
      transition_allowed: false,
      last_transition_reason: "migrated_default",
    };
  }
  if (state.workflow.pending_confirmation_slot_id == null) {
    state.workflow.pending_confirmation_slot_id = null;
  }
  if (state.workflow.pending_interaction_module == null) {
    state.workflow.pending_interaction_module = null;
  }
  syncWorkflowState(state);
}

const REVISION_LOG_CAP = 50;

function resetPerTurnState(state: InterviewState): void {
  state.system_assessment.tool_calls_this_turn = [];
  state.system_assessment.state_updates_this_turn = [];
  state.conversation_meta.tool_call_trace_ids = [];

  const log = state.preview_projection.preview_revision_log;
  if (log.length > REVISION_LOG_CAP) {
    state.preview_projection.preview_revision_log = log.slice(-REVISION_LOG_CAP);
  }
}

function toModelRouteObject(route: ReturnType<typeof getLastModelRoute>) {
  if (!route.modelUsed || !route.provider) {
    return null;
  }
  return {
    model: route.modelUsed,
    provider: route.provider,
  };
}

const TASK_TYPE_CANDIDATES: TaskType[] = ["answer_question", "ask_for_help", "other_discussion"];

function extractionUpdateCount(extraction: InterviewState["system_assessment"]["last_extraction_output"]): number {
  if (!extraction) return 0;
  return extraction.active_slot_updates.length + extraction.current_section_supporting_updates.length;
}

export async function runAgentTurn(input: {
  sessionId: string;
  userMessage: string;
  userTurnId: string;
  state: InterviewState;
  recentMessages?: InterviewMessage[];
  language?: "en" | "zh";
}): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  const traceCtx = {
    runtime: "legacy.runAgentTurn",
    sessionId: input.sessionId,
    turnId: input.userTurnId,
  } as const;

  traceRunStart(traceCtx, {
    message_len: input.userMessage.length,
    language: input.language ?? "en",
    workflow_phase: input.state.workflow?.phase ?? "unknown",
    active_section: input.state.workflow?.active_section_id ?? "unknown",
  });

  const repo = getInterviewRepository();
  try {
    await runStep({
      ctx: traceCtx,
      step: "migrate_state",
      inputSummary: {
        workflow_phase: input.state.workflow?.phase ?? "unknown",
        active_section: input.state.workflow?.active_section_id ?? "unknown",
      },
      successSummary: () => ({
        workflow_phase: input.state.workflow.phase,
        active_section: input.state.workflow.active_section_id,
      }),
      fn: () => migrateStateIfNeeded(input.state),
    });

    await runStep({
      ctx: traceCtx,
      step: "reset_turn_state",
      inputSummary: {
        tool_calls_before: input.state.system_assessment.tool_calls_this_turn.length,
        state_updates_before: input.state.system_assessment.state_updates_this_turn.length,
      },
      successSummary: () => ({
        tool_calls_after: input.state.system_assessment.tool_calls_this_turn.length,
        state_updates_after: input.state.system_assessment.state_updates_this_turn.length,
      }),
      fn: () => resetPerTurnState(input.state),
    });

    const planner = await runStep({
      ctx: traceCtx,
      step: "classify_turn",
      inputSummary: {
        message_len: input.userMessage.length,
        workflow_phase: input.state.workflow.phase,
        active_section: input.state.workflow.active_section_id,
        task_type_candidates: TASK_TYPE_CANDIDATES,
      },
      successSummary: (value) => ({
        selected_task_type: value.classification.task_type,
        planner_rationale: value.classification.rationale,
        tool_trace_count: value.toolLogs.length,
      }),
      fn: () =>
        classifyTurn({
          repo,
          sessionId: input.sessionId,
          turnId: input.userTurnId,
          userMessage: input.userMessage,
          state: input.state,
        }),
    });

    const plannerTaskType = await runStep({
      ctx: traceCtx,
      step: "route_task",
      inputSummary: {
        task_type_candidates: TASK_TYPE_CANDIDATES,
      },
      successSummary: (value) => ({
        selected_task_type: value,
      }),
      fn: () => planner.classification.task_type,
    });

    const toolTrace: ToolActionLog[] = [...planner.toolLogs];
    let assistantMessage = "";
    let interactionModule: InteractionModule = { type: "none", payload: {} };
    let extractionContractSummary = input.state.system_assessment.last_extraction_output;

    const lang = input.language ?? "en";

    if (plannerTaskType === "answer_question") {
      const answerResult = await runStep({
        ctx: traceCtx,
        step: "run_answer_task",
        inputSummary: {
          task_type: plannerTaskType,
          active_section: input.state.workflow.active_section_id,
          message_len: input.userMessage.length,
        },
        successSummary: (value) => ({
          task_type: plannerTaskType,
          interaction_module: value.interactionModule.type,
          reply_len: value.assistantMessage.length,
          tool_trace_count: value.toolLogs.length,
          updated_field_count:
            input.state.system_assessment.last_turn_diagnostics?.captured_fields_this_turn.length ?? 0,
          extraction_update_count: extractionUpdateCount(value.extractionContractSummary),
        }),
        fn: () =>
          runAnswerQuestionTask({
            repo,
            sessionId: input.sessionId,
            turnId: input.userTurnId,
            userMessage: input.userMessage,
            state: input.state,
            language: lang,
          }),
      });
      assistantMessage = answerResult.assistantMessage;
      interactionModule = answerResult.interactionModule;
      extractionContractSummary = answerResult.extractionContractSummary;
      toolTrace.push(...answerResult.toolLogs);
    } else if (plannerTaskType === "ask_for_help") {
      const helpResult = await runStep({
        ctx: traceCtx,
        step: "run_help_task",
        inputSummary: {
          task_type: plannerTaskType,
          active_section: input.state.workflow.active_section_id,
          message_len: input.userMessage.length,
        },
        successSummary: (value) => ({
          task_type: plannerTaskType,
          interaction_module: value.interactionModule.type,
          reply_len: value.assistantMessage.length,
          tool_trace_count: value.toolLogs.length,
        }),
        fn: () =>
          runHelpAboutQuestionTask({
            repo,
            sessionId: input.sessionId,
            turnId: input.userTurnId,
            userMessage: input.userMessage,
            state: input.state,
            language: lang,
          }),
      });
      assistantMessage = helpResult.assistantMessage;
      interactionModule = helpResult.interactionModule;
      toolTrace.push(...helpResult.toolLogs);
    } else {
      const discussionResult = await runStep({
        ctx: traceCtx,
        step: "run_discussion_task",
        inputSummary: {
          task_type: plannerTaskType,
          active_section: input.state.workflow.active_section_id,
          message_len: input.userMessage.length,
        },
        successSummary: (value) => ({
          task_type: plannerTaskType,
          interaction_module: value.interactionModule.type,
          reply_len: value.assistantMessage.length,
          tool_trace_count: value.toolLogs.length,
        }),
        fn: () =>
          runDiscussionTask({
            repo,
            sessionId: input.sessionId,
            turnId: input.userTurnId,
            userMessage: input.userMessage,
            state: input.state,
            language: lang,
          }),
      });
      assistantMessage = discussionResult.assistantMessage;
      interactionModule = discussionResult.interactionModule;
      toolTrace.push(...discussionResult.toolLogs);
    }

    const completionState = await runStep({
      ctx: traceCtx,
      step: "evaluate_completion",
      inputSummary: {
        active_section: input.state.workflow.active_section_id,
      },
      successSummary: (value) => ({
        completion_level: value.completion_level,
        completion_score: value.completion_score,
      }),
      fn: () => evaluateCompletion(input.state),
    });

    const updatedPreview = await runStep({
      ctx: traceCtx,
      step: "compose_preview",
      inputSummary: {
        active_section: input.state.workflow.active_section_id,
      },
      successSummary: (value) => ({
        preview_section_count: Object.keys(value.sections ?? {}).length,
      }),
      fn: () => composePreview(input.state),
    });

    await runStep({
      ctx: traceCtx,
      step: "sync_workflow",
      inputSummary: {
        workflow_phase_before: input.state.workflow.phase,
        active_section_before: input.state.workflow.active_section_id,
      },
      successSummary: () => ({
        workflow_phase_after: input.state.workflow.phase,
        active_section_after: input.state.workflow.active_section_id,
      }),
      fn: () => syncWorkflowState(input.state),
    });

    const result = await runStep({
      ctx: traceCtx,
      step: "assemble_result",
      inputSummary: {
        planner_task_type: plannerTaskType,
        active_section: input.state.workflow.active_section_id,
      },
      successSummary: (value) => ({
        planner_task_type: value.planner_task_type,
        interaction_module: value.interaction_module.type,
        reply_len: value.assistant_message.length,
        tool_trace_count: value.tool_trace.length,
        completion_score: completionState.completion_score,
      }),
      fn: () => ({
        assistant_message: assistantMessage,
        interaction_module: interactionModule,
        updated_preview: updatedPreview,
        workflow_state: input.state.workflow,
        planner_task_type: plannerTaskType,
        model_route_used: toModelRouteObject(getLastModelRoute()),
        tool_trace: toolTrace,
        planner_trace: {
          ...planner.plannerTrace,
          task_type: planner.classification.task_type,
          rationale: planner.classification.rationale,
          completion_level: completionState.completion_level,
          completion_score: completionState.completion_score,
        },
        turn_intent: input.state.system_assessment.last_turn_intent,
        extraction_contract_summary: extractionContractSummary,
        contract_validation_result: input.state.system_assessment.last_contract_validation_result,
      }),
    });

    traceRunEnd(traceCtx, {
      status: "ok",
      durationMs: Date.now() - startedAt,
      summary: {
        message_len: input.userMessage.length,
        active_section: input.state.workflow?.active_section_id ?? "unknown",
        intent: result.turn_intent?.task_type ?? result.planner_task_type,
        planner_task_type: result.planner_task_type,
        reply_len: result.assistant_message.length,
        tool_trace_count: result.tool_trace.length,
        duration_ms: Date.now() - startedAt,
      },
    });

    return result;
  } catch (error) {
    traceRunEnd(traceCtx, {
      status: "fail",
      durationMs: Date.now() - startedAt,
      summary: {
        message_len: input.userMessage.length,
        active_section: input.state.workflow?.active_section_id ?? "unknown",
        ...toErrorSummary(error),
      },
    });
    throw error;
  }
}
