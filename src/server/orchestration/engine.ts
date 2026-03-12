import { END, START, Annotation, StateGraph } from "@langchain/langgraph";
import { CompletionState, InterviewMessage, InterviewState, PlannerAction, QuestionStyle, QuestionType } from "@/lib/types";
import { evaluateCompletion } from "@/server/rules/completion";
import { detectFatigueFromMessage } from "@/server/rules/followup";
import { generateAssistantResponse } from "@/server/services/assistant";
import { extractStructuredUpdates } from "@/server/services/extraction";
import { composePreview } from "@/server/services/preview";
import { createHandoffSummary } from "@/server/services/handoff";
import { runPlannerTurn } from "@/server/planner/runtime";
import { syncWorkflowState } from "@/server/services/workflow";
import { getLastModelRoute, getContextWindowInfo, getCumulativeTokenUsage, type ContextWindowInfo, type TokenUsage } from "@/server/model/adapters";
import { getInterviewRepository } from "@/server/repo";
import { createDefaultChecklist } from "@/server/rules/checklist";

interface EngineContext {
  sessionId: string;
  userMessage: string;
  userTurnId: string;
  state: InterviewState;
  completionState?: CompletionState;
  nextQuestion?: string;
  questionType?: QuestionType;
  assistantMessage?: string;
  preview?: Record<string, unknown>;
  handoffSummary?: Record<string, unknown>;
  nextAction?: "continue" | "checkpoint" | "generate_brief" | "handoff";
  questionReason?: string;
  plannerAction?: PlannerAction;
  questionStyle?: QuestionStyle;
  checkpointRecommended?: boolean;
  userFacingProgressNote?: string;
  sectionAdvanced?: boolean;
  currentSectionName?: string;
  recentMessages?: InterviewMessage[];
  contextWindowInfo?: ContextWindowInfo;
  cumulativeTokens?: TokenUsage;
}

const EngineAnnotation = Annotation.Root({
  ctx: Annotation<EngineContext>({
    reducer: (_, next) => next,
    default: () => ({
      sessionId: "",
      userMessage: "",
      userTurnId: "",
      state: {} as InterviewState,
    }),
  }),
});

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
      next_question_slot_id: null,
      required_open_slot_ids: [],
      transition_allowed: false,
      last_transition_reason: "migrated_default",
    };
  }
  syncWorkflowState(state);
}

const receiveUserMessage = async (input: { ctx: EngineContext }) => {
  const next = { ...input.ctx };
  migrateStateIfNeeded(next.state);
  detectFatigueFromMessage(next.state, next.userMessage);
  next.state.conversation_meta.interview_stage = "discovery";
  next.state.system_assessment.tool_calls_this_turn = [];
  next.state.system_assessment.state_updates_this_turn = [];
  next.state.conversation_meta.tool_call_trace_ids = [];
  return { ctx: next };
};

const extractStructuredUpdatesNode = async (input: { ctx: EngineContext }) => {
  const next = { ...input.ctx };
  await extractStructuredUpdates({
    state: next.state,
    userMessage: next.userMessage,
    sourceTurnId: next.userTurnId,
  });
  return { ctx: next };
};

const updateInterviewState = async (input: { ctx: EngineContext }) => {
  const next = { ...input.ctx };
  next.state.conversation_meta.interview_stage = "clarification";
  return { ctx: next };
};

const evaluateCompletionNode = async (input: { ctx: EngineContext }) => {
  const next = { ...input.ctx };
  next.completionState = evaluateCompletion(next.state);
  const route = getLastModelRoute();
  next.state.system_assessment.model_route_used = route.modelUsed;
  next.state.conversation_meta.model_provider = route.provider;
  next.state.conversation_meta.model_name = route.modelUsed;
  return { ctx: next };
};

const plannerRuntimeNode = async (input: { ctx: EngineContext }) => {
  const next = { ...input.ctx };
  const decision = await runPlannerTurn({
    sessionId: next.sessionId,
    turnId: next.userTurnId,
    userMessage: next.userMessage,
    state: next.state,
    completionState: next.completionState,
  });

  next.plannerAction = decision.plannerAction;
  next.questionStyle = decision.questionStyle;
  next.questionType = decision.questionType;
  next.nextQuestion = decision.nextQuestion;
  next.questionReason = decision.rationale;
  next.checkpointRecommended = decision.checkpointRecommended;
  next.userFacingProgressNote = decision.userFacingProgressNote;
  next.sectionAdvanced = decision.sectionAdvanced;
  next.currentSectionName = decision.currentSectionName;

  if (decision.plannerAction === "handoff") {
    next.nextAction = "handoff";
    next.state.conversation_meta.interview_stage = "handoff";
  } else if (decision.plannerAction === "generate_brief") {
    next.nextAction = "generate_brief";
    next.state.conversation_meta.interview_stage = "checkpoint";
  } else if (decision.plannerAction === "checkpoint") {
    next.nextAction = "checkpoint";
    next.state.conversation_meta.interview_stage = "checkpoint";
  } else {
    next.nextAction = "continue";
    next.state.conversation_meta.interview_stage = "clarification";
  }
  return { ctx: next };
};

const createHandoffSummaryNode = async (input: { ctx: EngineContext }) => {
  const next = { ...input.ctx };
  if (next.nextAction === "handoff") {
    const handoff = await createHandoffSummary(next.sessionId, next.state);
    next.handoffSummary = handoff.summary_jsonb;
  }
  return { ctx: next };
};

const generateAssistantResponseNode = async (input: { ctx: EngineContext }) => {
  const next = { ...input.ctx };

  const repo = getInterviewRepository();
  const recentMessages = await repo.listMessages(next.sessionId);
  next.recentMessages = recentMessages.slice(-8);

  next.assistantMessage = await generateAssistantResponse({
    state: next.state,
    userMessage: next.userMessage,
    nextQuestion: next.nextQuestion ?? "Could you share one concrete example?",
    questionType: next.questionType ?? "clarify",
    questionStyle: next.questionStyle,
    plannerAction: next.plannerAction,
    userFacingProgressNote: next.userFacingProgressNote,
    recentMessages: next.recentMessages,
    sectionAdvanced: next.sectionAdvanced,
    currentSectionName: next.currentSectionName,
    workflowState: next.state.workflow,
  });

  next.contextWindowInfo = getContextWindowInfo();
  next.cumulativeTokens = getCumulativeTokenUsage();

  return { ctx: next };
};

const composePreviewNode = async (input: { ctx: EngineContext }) => {
  const next = { ...input.ctx };
  next.preview = composePreview(next.state);
  return { ctx: next };
};

const graph = new StateGraph(EngineAnnotation)
  .addNode("receive_user_message", receiveUserMessage)
  .addNode("extract_structured_updates", extractStructuredUpdatesNode)
  .addNode("update_interview_state", updateInterviewState)
  .addNode("evaluate_completion", evaluateCompletionNode)
  .addNode("planner_runtime", plannerRuntimeNode)
  .addNode("create_handoff_summary", createHandoffSummaryNode)
  .addNode("generate_assistant_response", generateAssistantResponseNode)
  .addNode("compose_preview", composePreviewNode)
  .addEdge(START, "receive_user_message")
  .addEdge("receive_user_message", "extract_structured_updates")
  .addEdge("extract_structured_updates", "update_interview_state")
  .addEdge("update_interview_state", "evaluate_completion")
  .addEdge("evaluate_completion", "planner_runtime")
  .addConditionalEdges("planner_runtime", ({ ctx }) => {
    if (ctx.nextAction === "handoff") return "create_handoff_summary";
    return "generate_assistant_response";
  })
  .addEdge("create_handoff_summary", "generate_assistant_response")
  .addEdge("generate_assistant_response", "compose_preview")
  .addEdge("compose_preview", END)
  .compile();

export async function runInterviewTurn(input: EngineContext) {
  const result = await graph.invoke({ ctx: input });
  return result.ctx;
}
