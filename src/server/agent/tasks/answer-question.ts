import { ExtractionOutput, InteractionModule, InterviewState, QuestionType, ToolActionLog } from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";
import { getPreviewSlots } from "@/server/services/preview-slots";
import { runAnswerTurnController } from "@/server/services/answer-turn";

export interface AnswerQuestionResult {
  assistantMessage: string;
  interactionModule: InteractionModule;
  toolLogs: ToolActionLog[];
  nextQuestion: string;
  questionType: QuestionType;
  extractionContractSummary: ExtractionOutput | null;
}

export async function runAnswerQuestionTask(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  userMessage: string;
  state: InterviewState;
  language?: "en" | "zh";
}): Promise<AnswerQuestionResult> {
  const controllerResult = await runAnswerTurnController({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    userMessage: params.userMessage,
    state: params.state,
    language: params.language,
  });
  const targetSlot = params.state.workflow.next_question_slot_id
    ? getPreviewSlots(params.state).find((slot) => slot.id === params.state.workflow.next_question_slot_id) ?? null
    : null;
  const nextQuestion = params.state.workflow.pending_review_section_id
    ? "Please confirm the current section or tell me what to adjust."
    : targetSlot?.question_label ?? "Could you share a bit more detail?";
  const questionType: QuestionType = params.state.workflow.pending_review_section_id
    ? "confirm"
    : params.state.workflow.pending_confirmation_slot_id
      ? "confirm"
      : "clarify";

  return {
    assistantMessage: controllerResult.assistantMessage,
    interactionModule: controllerResult.interactionModule,
    toolLogs: controllerResult.toolLogs,
    nextQuestion,
    questionType,
    extractionContractSummary: params.state.system_assessment.last_extraction_output,
  };
}
