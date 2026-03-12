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
      pending_interaction_module: null,
      next_question_slot_id: null,
      required_open_slot_ids: [],
      transition_allowed: false,
      last_transition_reason: "migrated_default",
    };
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

export async function runAgentTurn(input: {
  sessionId: string;
  userMessage: string;
  userTurnId: string;
  state: InterviewState;
  recentMessages?: InterviewMessage[];
}): Promise<AgentTurnResult> {
  const repo = getInterviewRepository();
  migrateStateIfNeeded(input.state);
  resetPerTurnState(input.state);

  const planner = await classifyTurn({
    repo,
    sessionId: input.sessionId,
    turnId: input.userTurnId,
    userMessage: input.userMessage,
    state: input.state,
  });

  let plannerTaskType: TaskType = planner.classification.task_type;
  const toolTrace: ToolActionLog[] = [...planner.toolLogs];

  let assistantMessage = "";
  let interactionModule: InteractionModule = { type: "none", payload: {} };

  if (plannerTaskType === "answer_question") {
    const answerResult = await runAnswerQuestionTask({
      repo,
      sessionId: input.sessionId,
      turnId: input.userTurnId,
      userMessage: input.userMessage,
      state: input.state,
    });
    assistantMessage = answerResult.assistantMessage;
    interactionModule = answerResult.interactionModule;
    toolTrace.push(...answerResult.toolLogs);
  } else if (plannerTaskType === "ask_for_help") {
    const helpResult = await runHelpAboutQuestionTask({
      repo,
      sessionId: input.sessionId,
      turnId: input.userTurnId,
      userMessage: input.userMessage,
      state: input.state,
    });
    assistantMessage = helpResult.assistantMessage;
    interactionModule = helpResult.interactionModule;
    toolTrace.push(...helpResult.toolLogs);
  } else {
    const discussionResult = await runDiscussionTask({
      repo,
      sessionId: input.sessionId,
      turnId: input.userTurnId,
      userMessage: input.userMessage,
      state: input.state,
    });
    assistantMessage = discussionResult.assistantMessage;
    interactionModule = discussionResult.interactionModule;
    toolTrace.push(...discussionResult.toolLogs);
  }

  const completionState = evaluateCompletion(input.state);
  const updatedPreview = composePreview(input.state);
  syncWorkflowState(input.state);

  return {
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
  };
}
