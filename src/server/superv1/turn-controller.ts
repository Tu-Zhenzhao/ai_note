import { randomUUID } from "crypto";
import { getInterviewRepository } from "@/server/repo";
import { getPoolStats, resetPool } from "@/server/repo/db";
import { TurnControllerV1, SuperV1TurnInput } from "@/server/superv1/contracts";
import { withConversationLock } from "@/server/superv1/lock";
import { getSuperV1Repository } from "@/server/superv1/repo";
import { buildDefaultSuperV1Template, SUPERV1_TEMPLATE_ID } from "@/server/superv1/template";
import { logExtractionEvent, logPlannerEvent } from "@/server/superv1/services/audit-log-service";
import {
  applyValidatedUpdates,
  buildPlannerResult,
  deriveStateView,
  summarizeAcceptedFacts,
} from "@/server/superv1/services/checklist-state-service";
import { extractStructuredFacts } from "@/server/superv1/services/extraction-service";
import { validateExtraction } from "@/server/superv1/services/extraction-validator";
import { classifyIntent } from "@/server/superv1/services/intent-classifier";
import { composeResponse } from "@/server/superv1/services/response-composer";
import { generateAiSuggestedDirections } from "@/server/superv1/services/ai-directions-generator";
import {
  SuperV1AiDirectionsRecord,
  SuperV1ExtractionOutput,
  SuperV1TurnResult,
  SuperV1ValidatedExtraction,
} from "@/server/superv1/types";
import {
  runStep,
  traceRunEnd,
  traceRunStart,
  traceStepError,
  traceStepStart,
  traceStepSuccess,
  toErrorSummary,
} from "@/server/tools/runtime-trace";

async function appendLegacyChatBookBestEffort(params: {
  conversationId: string;
  turnId: string;
  acceptedFacts: string[];
}) {
  if (params.acceptedFacts.length === 0) return;
  const legacyRepo = getInterviewRepository();
  for (const fact of params.acceptedFacts) {
    await legacyRepo.addChatBookEntry({
      id: randomUUID(),
      session_id: params.conversationId,
      entry_type: "direct_user_fact",
      text: fact,
      module: null,
      confidence: 0.8,
      status: "active",
      source_turn_ids: [params.turnId],
      metadata_json: { source: "superv1" },
      created_at: new Date().toISOString(),
    });
  }
}

const EMPTY_EXTRACTION: SuperV1ExtractionOutput = {
  filled_items: [],
  ambiguous_items: [],
  possible_items: [],
};

const EMPTY_VALIDATED: SuperV1ValidatedExtraction = {
  accepted_updates: [],
  rejected_updates: [],
  ambiguous_items: [],
};

function latestAnswersUpdatedAt(answers: { updated_at: string }[]): string | null {
  if (answers.length === 0) return null;
  return answers.reduce((latest, answer) => {
    if (!latest) return answer.updated_at;
    return answer.updated_at > latest ? answer.updated_at : latest;
  }, "");
}

function isTransientDbConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    message?: string;
    code?: string;
    cause?: { message?: string; code?: string };
  };
  const message = (err.message ?? err.cause?.message ?? "").toLowerCase();
  const code = (err.code ?? err.cause?.code ?? "").toUpperCase();

  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "57P01") return true;
  return (
    message.includes("connection terminated unexpectedly") ||
    message.includes("not queryable") ||
    message.includes("connection terminated") ||
    message.includes("connection error")
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class SuperV1TurnController implements TurnControllerV1 {
  async handleUserTurn(input: SuperV1TurnInput): Promise<SuperV1TurnResult> {
    const startedAt = Date.now();
    const repo = getSuperV1Repository();
    const language = input.language ?? "en";
    const userTurnId = randomUUID();
    const traceCtx = {
      runtime: "superv1.handleUserTurn",
      conversationId: input.conversationId,
      turnId: userTurnId,
    } as const;
    const emitPhaseProgress = (phase: "intent_classification" | "structured_extraction" | "response_generation", status: "start" | "done") => {
      if (!input.onPhaseProgress) return;
      try {
        input.onPhaseProgress({ phase, status });
      } catch {
        // UI progress hook should never break runtime execution.
      }
    };

    traceRunStart(traceCtx, {
      message_len: input.userMessage.length,
      language,
    });

    const lockStartedAt = Date.now();
    traceStepStart(traceCtx, "acquire_lock", {
      conversation_id: input.conversationId,
    });

    let lockAcquired = false;
    try {
      const locked = await withConversationLock(input.conversationId, async () => {
        lockAcquired = true;
        traceStepSuccess(traceCtx, "acquire_lock", Date.now() - lockStartedAt, {
          conversation_id: input.conversationId,
        });

        const conversation = await runStep({
          ctx: traceCtx,
          step: "load_conversation",
          inputSummary: {
            conversation_id: input.conversationId,
          },
          successSummary: (value) => ({
            template_id: value.template_id,
            status: value.status,
            active_section: value.active_section_id,
          }),
          fn: async () => {
            const current = await repo.getConversation(input.conversationId);
            if (!current) {
              throw new Error("Conversation not found");
            }
            return current;
          },
        });

        await runStep({
          ctx: traceCtx,
          step: "ensure_template",
          inputSummary: {
            template_id: SUPERV1_TEMPLATE_ID,
          },
          successSummary: (value) => ({
            template_id: SUPERV1_TEMPLATE_ID,
            question_count: value.length,
          }),
          fn: async () => {
            const built = buildDefaultSuperV1Template(SUPERV1_TEMPLATE_ID);
            await repo.ensureTemplate(SUPERV1_TEMPLATE_ID, built);
            return built;
          },
        });

        await runStep({
          ctx: traceCtx,
          step: "ensure_answers",
          inputSummary: {
            conversation_id: input.conversationId,
            template_id: conversation.template_id,
          },
          successSummary: () => ({
            conversation_id: input.conversationId,
          }),
          fn: () => repo.ensureChecklistAnswers(input.conversationId, conversation.template_id),
        });

        const context = await runStep({
          ctx: traceCtx,
          step: "load_context",
          inputSummary: {
            template_id: conversation.template_id,
          },
          successSummary: (value) => ({
            question_count: value.questions.length,
            answer_count: value.answers.length,
            recent_turn_count: value.recentTurns.length,
          }),
          fn: async () => {
            const [questions, answers, recentTurns] = await Promise.all([
              repo.listTemplateQuestions(conversation.template_id),
              repo.listAnswers(input.conversationId),
              repo.listTurns(input.conversationId, 6),
            ]);
            return { questions, answers, recentTurns };
          },
        });
        const questions = context.questions;
        const answers = context.answers;
        const recentTurns = context.recentTurns;

        await runStep({
          ctx: traceCtx,
          step: "append_user_turn",
          inputSummary: {
            message_len: input.userMessage.length,
          },
          successSummary: () => ({
            role: "user",
            turn_id: userTurnId,
            message_len: input.userMessage.length,
          }),
          fn: () =>
            repo.addTurn({
              id: userTurnId,
              conversation_id: input.conversationId,
              role: "user",
              message_text: input.userMessage,
              created_at: new Date().toISOString(),
            }),
        });

        const previousAssistantQuestion =
          [...recentTurns].reverse().find((turn) => turn.role === "assistant")?.message_text ?? "";
        const prePlanner = buildPlannerResult(questions, answers);
        const openQuestionsInActiveSection = questions.filter((question) => {
          if (question.section_id !== prePlanner.active_section_id) return false;
          const answer = answers.find((item) => item.question_id === question.question_id);
          if (!question.is_required) return false;
          return !answer || answer.status === "empty" || answer.status === "needs_clarification";
        });

        emitPhaseProgress("intent_classification", "start");
        const intent = await runStep({
          ctx: traceCtx,
          step: "classify_intent",
          inputSummary: {
            message_len: input.userMessage.length,
            active_section: prePlanner.active_section_id,
            previous_assistant_question_len: previousAssistantQuestion.length,
            recent_turn_count: recentTurns.length,
          },
          successSummary: (value) => ({
            intent: value.intent,
            confidence: value.confidence,
          }),
          fn: () =>
            classifyIntent({
              userMessage: input.userMessage,
              currentSectionId: prePlanner.active_section_id,
              recentTurns,
              previousAssistantQuestion,
            }),
        });
        emitPhaseProgress("intent_classification", "done");

        if (intent.intent === "answer_question") {
          emitPhaseProgress("structured_extraction", "start");
        }
        const extraction = await runStep({
          ctx: traceCtx,
          step: "extract_structured_facts",
          inputSummary: {
            intent: intent.intent,
            open_question_count: openQuestionsInActiveSection.length,
          },
          successSummary: (value) => ({
            filled_count: value.filled_items.length,
            ambiguous_count: value.ambiguous_items.length,
            possible_count: value.possible_items.length,
          }),
          fn: () =>
            intent.intent === "answer_question"
              ? extractStructuredFacts({
                  userMessage: input.userMessage,
                  activeSectionId: prePlanner.active_section_id,
                  openQuestions: openQuestionsInActiveSection,
                  recentTurns,
                })
              : EMPTY_EXTRACTION,
        });

        const validated = await runStep({
          ctx: traceCtx,
          step: "validate_extraction",
          inputSummary: {
            intent: intent.intent,
            filled_count: extraction.filled_items.length,
          },
          successSummary: (value) => ({
            accepted_updates_count: value.accepted_updates.length,
            rejected_updates_count: value.rejected_updates.length,
            ambiguous_count: value.ambiguous_items.length,
          }),
          fn: () =>
            intent.intent === "answer_question"
              ? validateExtraction({
                  extraction,
                  openQuestions: openQuestionsInActiveSection,
                  answers,
                })
              : EMPTY_VALIDATED,
        });

        await runStep({
          ctx: traceCtx,
          step: "log_extraction_event",
          inputSummary: {
            intent: intent.intent,
          },
          successSummary: () => ({
            logged: intent.intent === "answer_question",
            accepted_updates_count: validated.accepted_updates.length,
            rejected_updates_count: validated.rejected_updates.length,
          }),
          fn: () =>
            intent.intent === "answer_question"
              ? logExtractionEvent({
                  repo,
                  conversationId: input.conversationId,
                  turnId: userTurnId,
                  extraction,
                  validated,
                })
              : undefined,
        });

        const nextAnswers = await runStep({
          ctx: traceCtx,
          step: "apply_validated_updates",
          inputSummary: {
            accepted_updates_count: validated.accepted_updates.length,
            ambiguous_count: validated.ambiguous_items.length,
          },
          successSummary: (value) => ({
            answer_count: value.length,
            accepted_updates_count: validated.accepted_updates.length,
          }),
          fn: () =>
            intent.intent === "answer_question"
              ? applyValidatedUpdates({
                  repo,
                  conversationId: input.conversationId,
                  sourceTurnId: userTurnId,
                  answers,
                  validated,
                })
              : answers,
        });
        if (intent.intent === "answer_question") {
          emitPhaseProgress("structured_extraction", "done");
        }

        const acceptedFactTexts = summarizeAcceptedFacts(validated.accepted_updates);

        const planner = await runStep({
          ctx: traceCtx,
          step: "plan_next_question",
          inputSummary: {
            answer_count: nextAnswers.length,
          },
          successSummary: (value) => ({
            active_section: value.active_section_id,
            next_question_id: value.next_question_id,
            unresolved_required_count: value.unresolved_required_question_ids.length,
          }),
          fn: () => buildPlannerResult(questions, nextAnswers),
        });

        await runStep({
          ctx: traceCtx,
          step: "log_planner_event",
          inputSummary: {
            next_question_id: planner.next_question_id,
          },
          successSummary: () => ({
            next_question_id: planner.next_question_id,
          }),
          fn: () =>
            logPlannerEvent({
              repo,
              conversationId: input.conversationId,
              turnId: userTurnId,
              plannerResult: planner,
            }),
        });

        const updatedConversation = await runStep({
          ctx: traceCtx,
          step: "update_conversation",
          inputSummary: {
            previous_status: conversation.status,
            previous_active_section: conversation.active_section_id,
          },
          successSummary: (value) => ({
            status: value.status,
            active_section: value.active_section_id,
            next_question_id: value.current_question_id,
          }),
          fn: async () => {
            const updated = {
              ...conversation,
              status: planner.next_question_id ? "active" : "completed",
              active_section_id: planner.active_section_id,
              current_question_id: planner.next_question_id,
              updated_at: new Date().toISOString(),
            } as const;
            await repo.updateConversation(updated);
            return updated;
          },
        });

        const aiDirectionsRecord = await runStep({
          ctx: traceCtx,
          step: "generate_ai_suggested_directions",
          required: false,
          inputSummary: {
            conversation_status: updatedConversation.status,
            next_question_id: planner.next_question_id,
          },
          successSummary: (value) => ({
            generated: !!value,
            direction_count: value?.payload_json.ai_suggested_directions.length ?? 0,
          }),
          skipSummary: {
            reason: "ai_suggested_directions_generation_failed",
          },
          fn: async (): Promise<SuperV1AiDirectionsRecord | null> => {
            if (planner.next_question_id) return null;

            const sourceAnswersUpdatedAt = latestAnswersUpdatedAt(nextAnswers);
            const existing = await repo.getAiSuggestedDirections(input.conversationId);
            const canReuse =
              existing &&
              existing.language === language &&
              existing.source_answers_updated_at === sourceAnswersUpdatedAt;
            if (canReuse) return existing;

            const turnsForDirections = await repo.listTurns(input.conversationId);
            const payload = await generateAiSuggestedDirections({
              language,
              turns: turnsForDirections,
              questions,
              answers: nextAnswers,
            });
            const now = new Date().toISOString();
            const record: SuperV1AiDirectionsRecord = {
              conversation_id: input.conversationId,
              language,
              payload_json: payload,
              source_turn_id: userTurnId,
              source_answers_updated_at: sourceAnswersUpdatedAt,
              created_at: existing?.created_at ?? now,
              updated_at: now,
            };
            await repo.upsertAiSuggestedDirections(record);
            return record;
          },
        });

        emitPhaseProgress("response_generation", "start");
        const reply = await runStep({
          ctx: traceCtx,
          step: "compose_response",
          inputSummary: {
            intent: intent.intent,
            accepted_updates_count: validated.accepted_updates.length,
            next_question_id: planner.next_question_id,
          },
          successSummary: (value) => ({
            reply_len: value.length,
            next_question_id: planner.next_question_id,
          }),
          fn: () =>
            composeResponse({
              intent: intent.intent,
              language,
              acceptedFacts: acceptedFactTexts,
              planner,
              userMessage: input.userMessage,
            }),
        });
        emitPhaseProgress("response_generation", "done");

        await runStep({
          ctx: traceCtx,
          step: "append_assistant_turn",
          inputSummary: {
            reply_len: reply.length,
          },
          successSummary: () => ({
            role: "assistant",
            reply_len: reply.length,
          }),
          fn: () =>
            repo.addTurn({
              id: randomUUID(),
              conversation_id: input.conversationId,
              role: "assistant",
              message_text: reply,
              created_at: new Date().toISOString(),
            }),
        });

        await runStep({
          ctx: traceCtx,
          step: "append_legacy_chatbook",
          required: false,
          inputSummary: {
            accepted_updates_count: acceptedFactTexts.length,
          },
          successSummary: () => ({
            appended_count: acceptedFactTexts.length,
          }),
          skipSummary: {
            reason: "legacy_chatbook_write_failed",
            accepted_updates_count: acceptedFactTexts.length,
          },
          fn: () =>
            appendLegacyChatBookBestEffort({
              conversationId: input.conversationId,
              turnId: userTurnId,
              acceptedFacts: acceptedFactTexts,
            }),
        });

        const state = await runStep({
          ctx: traceCtx,
          step: "derive_state",
          inputSummary: {
            active_section: updatedConversation.active_section_id,
          },
          successSummary: (value) => ({
            active_section: value.activeSectionId,
            completion_ratio: value.completion.ratio,
            filled_count: value.completion.filled,
            needs_clarification_count: value.completion.needs_clarification,
          }),
          fn: () =>
            deriveStateView({
              conversation: updatedConversation,
              questions,
              answers: nextAnswers,
              aiSuggestedDirections: aiDirectionsRecord?.payload_json ?? null,
            }),
        });

        const result = await runStep({
          ctx: traceCtx,
          step: "return_result",
          inputSummary: {
            intent: intent.intent,
            next_question_id: planner.next_question_id,
          },
          successSummary: (value) => ({
            intent: value.intent.intent,
            next_question_id: value.next_question.question_id,
            reply_len: value.reply.length,
          }),
          fn: () => ({
            conversationId: input.conversationId,
            reply,
            state,
            next_question: {
              question_id: planner.next_question_id,
              question_text: planner.next_question_text,
            },
            intent,
            planner_result: planner,
          }),
        });

        return {
          result,
          traceSummary: {
            active_section: planner.active_section_id,
            intent: intent.intent,
            accepted_updates_count: validated.accepted_updates.length,
            rejected_updates_count: validated.rejected_updates.length,
            ambiguous_count: validated.ambiguous_items.length,
            next_question_id: planner.next_question_id,
            reply_len: reply.length,
          },
        };
      });

      traceRunEnd(traceCtx, {
        status: "ok",
        durationMs: Date.now() - startedAt,
        summary: {
          message_len: input.userMessage.length,
          ...locked.traceSummary,
          duration_ms: Date.now() - startedAt,
        },
      });

      return locked.result;
    } catch (error) {
      const retryAttempted = Boolean((input as SuperV1TurnInput & { __dbRetryAttempted?: boolean }).__dbRetryAttempted);
      if (!retryAttempted && isTransientDbConnectionError(error)) {
        const poolStats = getPoolStats();
        console.warn(
          `[superv1] transient DB connection error detected; resetting pool and retrying turn once for conversation ${input.conversationId}`,
          poolStats ?? {},
        );
        await resetPool();
        await sleep(180);
        return this.handleUserTurn({
          ...input,
          __dbRetryAttempted: true,
        } as SuperV1TurnInput);
      }
      if (!lockAcquired) {
        traceStepError(traceCtx, "acquire_lock", Date.now() - lockStartedAt, error, {
          conversation_id: input.conversationId,
        });
      }
      traceRunEnd(traceCtx, {
        status: "fail",
        durationMs: Date.now() - startedAt,
        summary: {
          message_len: input.userMessage.length,
          ...toErrorSummary(error),
        },
      });
      throw error;
    }
  }
}

let controller: SuperV1TurnController | null = null;

export function getSuperV1TurnController(): SuperV1TurnController {
  if (!controller) {
    controller = new SuperV1TurnController();
  }
  return controller;
}
