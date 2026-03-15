import { randomUUID } from "crypto";
import { getInterviewRepository } from "@/server/repo";
import { getPoolStats, resetPool } from "@/server/repo/db";
import { TurnControllerV1, SuperV1TurnInput } from "@/server/superv1/contracts";
import { withConversationLock } from "@/server/superv1/lock";
import { getSuperV1Repository } from "@/server/superv1/repo";
import { buildDefaultSuperV1Template, SUPERV1_TEMPLATE_ID } from "@/server/superv1/template";
import {
  detectQuestionAlignedAnswer,
  getLocalizedQuestionGuidance,
} from "@/server/superv1/question-guidance";
import {
  logExtractionEvent,
  logPlannerEvent,
  logRoutingEvent,
} from "@/server/superv1/services/audit-log-service";
import {
  applyValidatedUpdates,
  buildPlannerResult,
  deriveStateView,
  summarizeAcceptedFacts,
} from "@/server/superv1/services/checklist-state-service";
import { extractStructuredFacts } from "@/server/superv1/services/extraction-service";
import { validateExtraction } from "@/server/superv1/services/extraction-validator";
import { classifyIntent } from "@/server/superv1/services/intent-classifier";
import {
  detectExplicitHelpAbandon,
  detectHelpAction,
  detectHelpSelection,
  detectLikelyOtherDiscussion,
  detectPlausibleAnswer,
  shouldUseHelpModeDetector,
} from "@/server/superv1/services/help-mode-detector";
import { composeResponse } from "@/server/superv1/services/response-composer";
import { generateAiSuggestedDirections } from "@/server/superv1/services/ai-directions-generator";
import {
  SuperV1AiDirectionsRecord,
  SuperV1DetectedHelpSelection,
  SuperV1ExtractionOutput,
  SuperV1HelpContext,
  SuperV1InteractionMode,
  SuperV1Intent,
  SuperV1RoutingMeta,
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

function normalizeInteractionMode(value: unknown): SuperV1InteractionMode {
  return value === "help_open" ? "help_open" : "interviewing";
}

function normalizeHelpContext(value: unknown): SuperV1HelpContext | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SuperV1HelpContext>;
  return {
    question_id: typeof raw.question_id === "string" ? raw.question_id : null,
    question_text: typeof raw.question_text === "string" ? raw.question_text : null,
    help_menu_version: Number.isFinite(raw.help_menu_version) ? Number(raw.help_menu_version) : 1,
    last_help_options: Array.isArray(raw.last_help_options)
      ? raw.last_help_options.filter((item): item is string => typeof item === "string")
      : [],
    last_selected_option: typeof raw.last_selected_option === "string" ? raw.last_selected_option : null,
    opened_at_turn_id: typeof raw.opened_at_turn_id === "string" ? raw.opened_at_turn_id : null,
  };
}

function buildHelpOptionsFromQuestion(questionText: string | null, language: "en" | "zh"): string[] {
  if (language === "zh") {
    return [
      "我可以先解释这个问题到底在问什么",
      "我可以给你 2-3 个回答示例",
      "我可以把问题改写得更简单",
    ];
  }
  return [
    "I can explain what this question is really asking",
    "I can give 2-3 concrete example answers",
    "I can simplify and rephrase the question",
  ];
}

function findQuestionTextById(params: { questionId: string | null; questions: { question_id: string; question_text: string }[] }): string | null {
  if (!params.questionId) return null;
  return params.questions.find((question) => question.question_id === params.questionId)?.question_text ?? null;
}

function normalizeValueToText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeValueToText(item))
      .filter((item): item is string => !!item);
    if (items.length === 0) return null;
    return items.join(", ");
  }
  try {
    const text = JSON.stringify(value);
    return text && text !== "{}" ? text : null;
  } catch {
    return null;
  }
}

function buildKnownBusinessContext(params: {
  answers: Array<{ question_id: string; status: string; value_json: unknown }>;
  questions: Array<{ question_id: string; question_text: string }>;
}): string[] {
  const questionMap = new Map(params.questions.map((q) => [q.question_id, q.question_text]));
  const priorityQuestionIds = [
    "cp_what_does_company_do",
    "cp_category",
    "cp_business_model",
    "ps_main_offering",
    "ma_primary_audience",
  ];
  const lines: string[] = [];
  for (const questionId of priorityQuestionIds) {
    const answer = params.answers.find((item) => item.question_id === questionId);
    if (!answer || (answer.status !== "filled" && answer.status !== "confirmed")) continue;
    const valueText = normalizeValueToText(answer.value_json);
    if (!valueText) continue;
    const questionText = questionMap.get(questionId) ?? questionId;
    lines.push(`${questionText}: ${valueText}`);
  }
  return lines.slice(0, 5);
}

function decideRoutedIntent(params: {
  modeBefore: SuperV1InteractionMode;
  classifierIntent: SuperV1Intent;
  userMessage: string;
  detectedHelpSelection: SuperV1DetectedHelpSelection | null;
  explicitHelpAbandon: boolean;
  helpActionDetected: boolean;
  questionAlignedAnswer: boolean;
}): { intent: SuperV1Intent; reason: string } {
  const hasPlausibleAnswer = detectPlausibleAnswer(params.userMessage) || params.questionAlignedAnswer;
  if (params.modeBefore === "help_open") {
    if (params.detectedHelpSelection?.detected || params.helpActionDetected) {
      return {
        intent: "ask_for_help",
        reason: "Help mode continuation detected from selection/help-action/clarification signal.",
      };
    }
    if (params.explicitHelpAbandon) {
      return {
        intent: "other_discussion",
        reason: "User explicitly abandoned the current help context.",
      };
    }
    if (hasPlausibleAnswer) {
      return {
        intent: "answer_question",
        reason: "Detected strong answer content while in help mode; exiting help flow.",
      };
    }
    if (params.classifierIntent === "other_discussion" || detectLikelyOtherDiscussion(params.userMessage)) {
      return {
        intent: "other_discussion",
        reason: "Detected side discussion while help context remains active.",
      };
    }
    if (params.classifierIntent === "ask_for_help") {
      return {
        intent: "ask_for_help",
        reason: "Classifier indicates continued help request while in help mode.",
      };
    }
    return {
      intent: "ask_for_help",
      reason: "Defaulting to ask_for_help while currently in help_open mode.",
    };
  }

  if (hasPlausibleAnswer) {
    return {
      intent: "answer_question",
      reason: "Detected plausible answer content for the current checklist question.",
    };
  }

  if (params.classifierIntent === "ask_for_help" || params.helpActionDetected) {
    return {
      intent: "ask_for_help",
      reason: "Detected help-seeking intent for the active question.",
    };
  }

  if (params.classifierIntent === "other_discussion" || detectLikelyOtherDiscussion(params.userMessage)) {
    return {
      intent: "other_discussion",
      reason: "Detected side discussion unrelated to answering the active question.",
    };
  }

  return {
    intent: "answer_question",
    reason: "Fallback to answer_question to preserve deterministic progression.",
  };
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
        const modeBefore = normalizeInteractionMode(conversation.interaction_mode);
        const helpContextBefore = normalizeHelpContext(conversation.help_context_json);
        const currentQuestionId = conversation.current_question_id ?? prePlanner.next_question_id;
        const currentQuestionText =
          helpContextBefore?.question_text ??
          findQuestionTextById({
            questionId: currentQuestionId,
            questions,
          }) ??
          prePlanner.next_question_text;
        const currentQuestionGuidance = getLocalizedQuestionGuidance(currentQuestionId, language);
        const openQuestionsInActiveSection = questions.filter((question) => {
          if (question.section_id !== prePlanner.active_section_id) return false;
          const answer = answers.find((item) => item.question_id === question.question_id);
          if (!question.is_required) return false;
          return !answer || answer.status === "empty" || answer.status === "needs_clarification";
        });

        emitPhaseProgress("intent_classification", "start");
        const intentRaw = await runStep({
          ctx: traceCtx,
          step: "classify_intent",
          inputSummary: {
            message_len: input.userMessage.length,
            active_section: prePlanner.active_section_id,
            interaction_mode: modeBefore,
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
              interactionMode: modeBefore,
              helpContext: helpContextBefore,
            }),
        });

        const detectedHelpSelection =
          shouldUseHelpModeDetector(modeBefore)
            ? detectHelpSelection({
                message: input.userMessage,
                helpContext: helpContextBefore,
              })
            : null;
        const explicitHelpAbandon =
          modeBefore === "help_open" && detectExplicitHelpAbandon(input.userMessage);
        const helpActionDetected = detectHelpAction(input.userMessage);
        const questionAlignedAnswer = detectQuestionAlignedAnswer({
          questionId: currentQuestionId,
          message: input.userMessage,
        });
        const intentRoutingDecision = decideRoutedIntent({
          modeBefore,
          classifierIntent: intentRaw.intent,
          userMessage: input.userMessage,
          detectedHelpSelection,
          explicitHelpAbandon,
          helpActionDetected,
          questionAlignedAnswer,
        });
        let intent = {
          ...intentRaw,
          intent: intentRoutingDecision.intent,
          reason: intentRoutingDecision.reason,
        };
        let routedReason = intentRoutingDecision.reason;

        let forcedExtractionFromProbe: SuperV1ExtractionOutput | null = null;
        let forcedValidatedFromProbe: SuperV1ValidatedExtraction | null = null;
        const helpProbeQuestionId = helpContextBefore?.question_id ?? currentQuestionId;
        const shouldRunHelpAnswerProbe =
          modeBefore === "help_open" &&
          intent.intent === "ask_for_help" &&
          !detectedHelpSelection?.detected &&
          !helpActionDetected &&
          !explicitHelpAbandon &&
          !!helpProbeQuestionId;
        if (shouldRunHelpAnswerProbe) {
          const probeOpenQuestions = questions.filter((question) => question.question_id === helpProbeQuestionId);
          if (probeOpenQuestions.length > 0) {
            const probeExtraction = await runStep({
              ctx: traceCtx,
              step: "probe_help_answer_extraction",
              inputSummary: {
                intent_before_probe: intent.intent,
                probe_question_id: helpProbeQuestionId,
              },
              successSummary: (value) => ({
                filled_count: value.filled_items.length,
                ambiguous_count: value.ambiguous_items.length,
                possible_count: value.possible_items.length,
              }),
              fn: () =>
                extractStructuredFacts({
                  userMessage: input.userMessage,
                  activeSectionId: prePlanner.active_section_id,
                  openQuestions: probeOpenQuestions,
                  recentTurns,
                }),
            });
            const probeValidated = await runStep({
              ctx: traceCtx,
              step: "probe_help_answer_validation",
              inputSummary: {
                probe_question_id: helpProbeQuestionId,
                filled_count: probeExtraction.filled_items.length,
              },
              successSummary: (value) => ({
                accepted_updates_count: value.accepted_updates.length,
                rejected_updates_count: value.rejected_updates.length,
              }),
              fn: () =>
                validateExtraction({
                  extraction: probeExtraction,
                  openQuestions: probeOpenQuestions,
                  answers,
                }),
            });
            if (probeValidated.accepted_updates.length > 0) {
              forcedExtractionFromProbe = probeExtraction;
              forcedValidatedFromProbe = probeValidated;
              intent = {
                ...intent,
                intent: "answer_question",
                confidence: Math.max(intent.confidence, 0.86),
                reason: "Accepted extraction update for the active help question; exiting help flow.",
              };
              routedReason = intent.reason;
            }
          }
        }

        let modeAfter: SuperV1InteractionMode = modeBefore;
        let helpContextAfter: SuperV1HelpContext | null = helpContextBefore;
        let helpTransition: SuperV1RoutingMeta["help_transition"] = "none";
        const isHelpContinuation = modeBefore === "help_open" && intent.intent === "ask_for_help";
        if (modeBefore === "interviewing" && intent.intent === "ask_for_help") {
          modeAfter = "help_open";
          helpTransition = "enter_help";
          helpContextAfter = {
            question_id: currentQuestionId,
            question_text: currentQuestionText,
            help_menu_version: 1,
            last_help_options: buildHelpOptionsFromQuestion(currentQuestionText, language),
            last_selected_option: detectedHelpSelection?.selected_option_text ?? null,
            opened_at_turn_id: userTurnId,
          };
        } else if (modeBefore === "help_open" && intent.intent === "ask_for_help") {
          modeAfter = "help_open";
          helpTransition = "stay_help";
          const nextVersion = (helpContextBefore?.help_menu_version ?? 1) + 1;
          helpContextAfter = {
            question_id: helpContextBefore?.question_id ?? currentQuestionId,
            question_text: helpContextBefore?.question_text ?? currentQuestionText,
            help_menu_version: nextVersion,
            last_help_options:
              helpContextBefore?.last_help_options.length
                ? helpContextBefore.last_help_options
                : buildHelpOptionsFromQuestion(currentQuestionText, language),
            last_selected_option: detectedHelpSelection?.selected_option_text ?? helpContextBefore?.last_selected_option ?? null,
            opened_at_turn_id: helpContextBefore?.opened_at_turn_id ?? userTurnId,
          };
        } else if (modeBefore === "help_open" && intent.intent === "answer_question") {
          modeAfter = "interviewing";
          helpTransition = "exit_help";
          helpContextAfter = null;
        } else if (modeBefore === "help_open" && intent.intent === "other_discussion" && explicitHelpAbandon) {
          modeAfter = "interviewing";
          helpTransition = "exit_help";
          helpContextAfter = null;
        }

        const routingMeta: SuperV1RoutingMeta = {
          mode_before: modeBefore,
          mode_after: modeAfter,
          route_reason: routedReason,
          help_transition: helpTransition,
          detected_help_selection: detectedHelpSelection,
        };

        await runStep({
          ctx: traceCtx,
          step: "log_routing_event",
          inputSummary: {
            raw_intent: intentRaw.intent,
            resolved_intent: intent.intent,
            mode_before: modeBefore,
            mode_after: modeAfter,
            help_transition: helpTransition,
          },
          successSummary: () => ({
            resolved_intent: intent.intent,
            mode_after: modeAfter,
            help_transition: helpTransition,
          }),
          fn: () =>
            logRoutingEvent({
              repo,
              conversationId: input.conversationId,
              turnId: userTurnId,
              intent: intent.intent,
              routing: routingMeta,
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
              ? forcedExtractionFromProbe ??
                extractStructuredFacts({
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
              ? forcedValidatedFromProbe ??
                validateExtraction({
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
        const knownBusinessContext = buildKnownBusinessContext({
          answers: nextAnswers,
          questions,
        });
        const shouldSkipPlannerProgress = modeAfter === "help_open" && intent.intent === "ask_for_help";

        const planner = await runStep({
          ctx: traceCtx,
          step: "plan_next_question",
          inputSummary: {
            answer_count: nextAnswers.length,
            skip_progression: shouldSkipPlannerProgress,
          },
          successSummary: (value) => ({
            active_section: value.active_section_id,
            next_question_id: value.next_question_id,
            unresolved_required_count: value.unresolved_required_question_ids.length,
          }),
          fn: () => {
            if (shouldSkipPlannerProgress) {
              return {
                ...prePlanner,
                next_question_id: helpContextAfter?.question_id ?? currentQuestionId ?? prePlanner.next_question_id,
                next_question_text: helpContextAfter?.question_text ?? currentQuestionText ?? prePlanner.next_question_text,
              };
            }
            return buildPlannerResult(questions, nextAnswers);
          },
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
            interaction_mode: value.interaction_mode,
          }),
          fn: async () => {
            const updated = {
              ...conversation,
              status:
                shouldSkipPlannerProgress || intent.intent !== "answer_question"
                  ? conversation.status
                  : planner.next_question_id
                    ? "active"
                    : "completed",
              active_section_id:
                shouldSkipPlannerProgress || intent.intent !== "answer_question"
                  ? conversation.active_section_id
                  : planner.active_section_id,
              current_question_id:
                shouldSkipPlannerProgress || intent.intent !== "answer_question"
                  ? helpContextAfter?.question_id ?? currentQuestionId ?? conversation.current_question_id
                  : planner.next_question_id,
              interaction_mode: modeAfter,
              help_context_json: helpContextAfter,
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
            if (planner.next_question_id || intent.intent !== "answer_question") return null;

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
              interactionMode: modeAfter,
              isHelpContinuation,
              helpContext: helpContextAfter,
              detectedHelpSelection: detectedHelpSelection,
              currentQuestionText: helpContextAfter?.question_text ?? currentQuestionText,
              currentQuestionGuidance,
              knownBusinessContext,
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
            interaction: routingMeta,
          }),
        });

        return {
          result,
          traceSummary: {
            active_section: planner.active_section_id,
            intent: intent.intent,
            mode_before: modeBefore,
            mode_after: modeAfter,
            help_transition: helpTransition,
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
