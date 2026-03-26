import { AgentRunInput, AgentRunOutput } from "@/server/askmore_v2/agents/contracts";
import { ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";
import { cloneRuntimeState, emitVisibleEvent, inferCurrentQuestionText } from "@/server/askmore_v2/agents/utils";
import { logAskmoreRuntime } from "@/server/askmore_v2/runtime/runtime-logger";

export async function runDiscussionAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const state = cloneRuntimeState(input.session.state_jsonb);
  ensureRuntimeStateDefaults(state);

  const now = new Date().toISOString();
  const activeQuestionId = input.context.active_question.question_id;
  const questionText = inferCurrentQuestionText(input);
  const capturedKey = activeQuestionId ? `${activeQuestionId}__discussion_context` : "discussion_context";
  const capturedText = input.userMessage.trim().slice(0, 220);
  const capturedSnippet = capturedText.replace(/\s+/g, " ").slice(0, 56);
  logAskmoreRuntime("discussion_agent_start", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    user_message: input.userMessage,
  });

  state.structured_knowledge[capturedKey] = {
    value: capturedText,
    confidence: 0.5,
    confirmed: false,
    updated_at: now,
  };
  state.session.pending_intent = "other_discussion";
  state.session.last_understanding_feedback = input.language === "zh"
    ? `我理解到你在补充背景（你提到：${capturedSnippet || "一些额外情况"}）。这能帮助我们更准确判断。`
    : `I understand you are adding background context (you mentioned: ${capturedSnippet || "additional context"}). This helps us judge the situation more accurately.`;
  state.recent_user_turns = [...(state.recent_user_turns ?? []), input.userMessage].slice(-8);
  if (activeQuestionId) {
    state.session.current_question_id = activeQuestionId;
  }

  const transition = input.language === "zh"
    ? "这段背景我已经记下了，我们回到当前问题继续。"
    : "I have captured this context. Let's return to the current question.";

  const events = [
    emitVisibleEvent({
      event_type: "understanding_summary",
      content: state.session.last_understanding_feedback,
      created_at: now,
    }),
    emitVisibleEvent({
      event_type: "state_update",
      content: input.language === "zh"
        ? `已记录：背景=${capturedSnippet || "已补充"}.`
        : `Recorded: background=${capturedSnippet || "captured"}.`,
      created_at: now,
    }),
    emitVisibleEvent({
      event_type: "transition_summary",
      content: transition,
      created_at: now,
    }),
  ];

  if (questionText) {
    events.push(
      emitVisibleEvent({
        event_type: "next_question",
        content: questionText,
        created_at: now,
      }),
    );
  }

  const nextQuestion = questionText
    ? {
        question_id: activeQuestionId,
        question_text: questionText,
      }
    : null;
  logAskmoreRuntime("discussion_agent_end", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    captured_key: capturedKey,
    next_question: nextQuestion?.question_id ?? null,
    event_types: events.map((event) => event.event_type),
  });

  return {
    state,
    status: input.session.status,
    turn_count: input.session.turn_count + 1,
    events,
    next_question: nextQuestion,
    messages_already_persisted: false,
    task_module: "DiscussionAgent",
    transition_reason: "discussion_agent_return_to_flow",
  };
}
