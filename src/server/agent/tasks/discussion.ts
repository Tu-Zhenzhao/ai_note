import { InteractionModule, InterviewState, ToolActionLog } from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";
import { generateAssistantResponse } from "@/server/services/assistant";
import {
  getOpenPreviewSlotsForSectionIndex,
  syncPreviewSlots,
} from "@/server/services/preview-slots";
import { getHistoryContext } from "@/server/tools/history-reader";

export interface DiscussionResult {
  assistantMessage: string;
  interactionModule: InteractionModule;
  toolLogs: ToolActionLog[];
}

function getCurrentQuestionTopic(state: InterviewState): string {
  syncPreviewSlots(state);
  const openSlots = getOpenPreviewSlotsForSectionIndex(
    state,
    state.conversation_meta.current_section_index,
  );
  return openSlots[0]?.question_label ?? "the current question";
}

const BACK_TO_QUESTION_PATTERNS = [
  /whenever you.*ready/i,
  /pick back up/i,
  /back to/i,
  /return to/i,
  /continue with/i,
];

function hasBackReminder(text: string): boolean {
  return BACK_TO_QUESTION_PATTERNS.some((re) => re.test(text));
}

export async function runDiscussionTask(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  userMessage: string;
  state: InterviewState;
}): Promise<DiscussionResult> {
  const historyContext = await getHistoryContext({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    query: params.userMessage,
    state: params.state,
    limit: 6,
  });

  const questionTopic = getCurrentQuestionTopic(params.state);

  const assistantMessage = await generateAssistantResponse({
    state: params.state,
    userMessage: params.userMessage,
    nextQuestion:
      params.state.workflow.phase === "confirming_section"
        ? "Please confirm this section or suggest edits so we can continue."
        : `Whenever you're ready, we can pick back up on ${questionTopic} — just say the word.`,
    questionType: "clarify",
    taskType: "other_discussion",
    plannerAction: "summarize",
    questionStyle: "reflect_and_advance",
    recentMessages: historyContext.messages,
    workflowState: params.state.workflow,
    userFacingProgressNote: questionTopic,
  });

  let finalMessage = assistantMessage;
  if (params.state.workflow.phase !== "confirming_section" && !hasBackReminder(finalMessage)) {
    finalMessage = `${finalMessage}\n\nWhenever you're ready, we can pick back up on **${questionTopic}** — just say the word.`;
  }

  return {
    assistantMessage: finalMessage,
    interactionModule: {
      type: "none",
      payload: {},
    },
    toolLogs: [historyContext.toolLog],
  };
}
