import {
  InterviewMessage,
  InterviewState,
  InterviewWorkflowState,
  PlannerAction,
  QuestionStyle,
  QuestionType,
  TaskType,
} from "@/lib/types";
import { generateModelText } from "@/server/model/adapters";
import { interviewSystemPrompt, interviewUserPrompt, loadTaskPrompt, TaskPromptKey } from "@/server/prompts/interview";
import { getCurrentSectionName } from "@/server/rules/checklist";
import { PREVIEW_SECTION_ORDER } from "@/server/services/preview-slots";

function humanizeSchemaText(text: string): string {
  return text
    .replace(/\b[a-z_]+\.(\w+)\b/g, (_, field: string) =>
      field.replace(/_/g, " "),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeQuestion(question: string): string {
  const humanized = humanizeSchemaText(question)
    .replace(/^confirm\s+/i, "Could you confirm ")
    .replace(/^could you confirm could you confirm/i, "Could you confirm");
  const firstQuestionMark = humanized.indexOf("?");
  const trimmed =
    firstQuestionMark >= 0
      ? humanized.slice(0, firstQuestionMark + 1)
      : `${humanized.replace(/[.]+$/, "")}?`;
  return trimmed;
}

function sectionNameFromId(sectionId: string | null | undefined): string {
  if (!sectionId) return "Current section";
  return PREVIEW_SECTION_ORDER.find((section) => section.id === sectionId)?.name ?? "Current section";
}

function stripUnauthorizedTransitions(text: string, allowTransition: boolean): string {
  if (allowTransition) return text.trim();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const blocked = /(that\s+completes|section\s+done|let'?s\s+move|moving\s+on|we\s+are\s+now\s+(officially\s+)?in)/i;
  const kept = sentences.filter((sentence) => !blocked.test(sentence));
  return kept.join(" ").trim();
}

/**
 * @deprecated No longer prepended to responses — section status is now shown
 * as a UI header in the chat panel instead.
 */
function _deterministicWorkflowLine(workflow: InterviewWorkflowState, fallbackSectionName: string): string {
  const sectionName = sectionNameFromId(workflow.active_section_id) || fallbackSectionName;
  if (workflow.phase === "confirming_section") {
    const pending = sectionNameFromId(workflow.pending_review_section_id);
    return `We are confirming ${pending || sectionName} before moving on.`;
  }
  return `We're still in ${sectionName}.`;
}

function minimalFallback(params: {
  nextQuestion: string;
  capturedFieldsThisTurn: string[];
  currentSectionName: string;
  state: InterviewState;
  userFacingProgressNote?: string;
}): string {
  const captured = params.capturedFieldsThisTurn.length;
  const ack = captured > 1 ? "Understood." : captured > 0 ? "Got it." : "I see.";
  const question = sanitizeQuestion(params.nextQuestion);
  return `${ack} ${question}`;
}

export async function generateAssistantResponse(params: {
  state: InterviewState;
  userMessage: string;
  nextQuestion: string;
  questionType: QuestionType;
  taskType?: TaskType;
  questionStyle?: QuestionStyle;
  plannerAction?: PlannerAction;
  userFacingProgressNote?: string;
  recentMessages?: InterviewMessage[];
  sectionAdvanced?: boolean;
  currentSectionName?: string;
  workflowState?: InterviewWorkflowState;
}): Promise<string> {
  const diagnostics = params.state.system_assessment.last_turn_diagnostics;
  const sectionName = params.currentSectionName ?? getCurrentSectionName(params.state);
  const workflow = params.workflowState ?? params.state.workflow;

  if (params.plannerAction === "handoff") {
    return "We've gathered strong context. This now needs a human strategist for the nuanced parts. I've prepared a handoff summary for them.";
  }

  const taskKey: TaskPromptKey = params.taskType ?? "answer_question";
  const basePrompt = interviewSystemPrompt();
  const taskPrompt = loadTaskPrompt(taskKey);
  const systemPrompt = `${basePrompt}\n\n---\n\n${taskPrompt}`;
  const userPrompt = interviewUserPrompt({
    userMessage: params.userMessage,
    state: params.state,
    nextQuestion: params.nextQuestion,
    questionType: params.questionType,
    taskType: params.taskType ?? "answer_question",
    capturedFieldsThisTurn: diagnostics.captured_fields_this_turn,
    capturedChecklistItemsThisTurn: diagnostics.captured_checklist_items_this_turn,
    recentMessages: params.recentMessages ?? [],
    sectionAdvanced: params.sectionAdvanced ?? false,
    currentSectionName: sectionName,
    workflowPhase: workflow.phase,
    transitionAllowed: workflow.transition_allowed,
    pendingReviewSectionName: sectionNameFromId(workflow.pending_review_section_id),
  });

  try {
    const response = await generateModelText({
      system: systemPrompt,
      prompt: userPrompt,
    });

    if (!response || response.trim().length < 10) {
      return minimalFallback({
        nextQuestion: params.nextQuestion,
        capturedFieldsThisTurn: diagnostics.captured_fields_this_turn,
        currentSectionName: sectionName,
        state: params.state,
        userFacingProgressNote: params.userFacingProgressNote,
      });
    }
    const cleaned = stripUnauthorizedTransitions(response, workflow.transition_allowed);
    if (!cleaned) {
      return sanitizeQuestion(params.nextQuestion);
    }
    return cleaned;
  } catch {
    return minimalFallback({
      nextQuestion: params.nextQuestion,
      capturedFieldsThisTurn: diagnostics.captured_fields_this_turn,
      currentSectionName: sectionName,
      state: params.state,
      userFacingProgressNote: params.userFacingProgressNote,
    });
  }
}
