import { InteractionModule, InterviewState, QuestionType, ToolActionLog } from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";
import { planFollowUp } from "@/server/rules/followup";
import { generateAssistantResponse } from "@/server/services/assistant";
import { isPreviewSectionComplete } from "@/server/services/preview-slots";
import { syncWorkflowState } from "@/server/services/workflow";
import { updateChecklistAnswer } from "@/server/tools/checklist-updater";
import { openConfirmSectionInteraction } from "@/server/tools/interaction-confirm-section";

export interface AnswerQuestionResult {
  assistantMessage: string;
  interactionModule: InteractionModule;
  toolLogs: ToolActionLog[];
  nextQuestion: string;
  questionType: QuestionType;
}

export async function runAnswerQuestionTask(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  userMessage: string;
  state: InterviewState;
}): Promise<AnswerQuestionResult> {
  const updateResult = await updateChecklistAnswer({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    userMessage: params.userMessage,
    state: params.state,
  });
  syncWorkflowState(params.state);

  const currentSectionIndex = params.state.conversation_meta.current_section_index;
  const sectionComplete = isPreviewSectionComplete(params.state, currentSectionIndex);
  const followUp = planFollowUp(params.state);
  const recentMessages = await params.repo.listMessages(params.sessionId);

  if (sectionComplete) {
    const confirmResult = await openConfirmSectionInteraction({
      repo: params.repo,
      sessionId: params.sessionId,
      turnId: params.turnId,
      state: params.state,
    });

    const assistantMessage = await generateAssistantResponse({
      state: params.state,
      userMessage: params.userMessage,
      nextQuestion: "Please review this section and confirm or edit anything before we continue.",
      questionType: "confirm",
      taskType: "answer_question",
      plannerAction: "confirm",
      questionStyle: "synthesize_and_confirm",
      recentMessages,
      currentSectionName: confirmResult.interactionModule.payload.section_name as string,
      workflowState: params.state.workflow,
    });

    return {
      assistantMessage,
      interactionModule: confirmResult.interactionModule,
      toolLogs: [updateResult.toolLog, confirmResult.toolLog],
      nextQuestion: "Please review this section and confirm or edit anything before we continue.",
      questionType: "confirm",
    };
  }

  const assistantMessage = await generateAssistantResponse({
    state: params.state,
    userMessage: params.userMessage,
    nextQuestion: followUp.nextQuestion,
    questionType: followUp.questionType,
    taskType: "answer_question",
    plannerAction: "ask",
    questionStyle: "reflect_and_advance",
    recentMessages,
    currentSectionName: followUp.targetField.split(".")[0],
    workflowState: params.state.workflow,
  });

  return {
    assistantMessage,
    interactionModule: {
      type: "none",
      payload: {},
    },
    toolLogs: [updateResult.toolLog],
    nextQuestion: followUp.nextQuestion,
    questionType: followUp.questionType,
  };
}
