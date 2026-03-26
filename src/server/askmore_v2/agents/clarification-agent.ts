import { AgentRunInput, AgentRunOutput } from "@/server/askmore_v2/agents/contracts";
import { ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";
import { cloneRuntimeState, emitVisibleEvent, inferCurrentQuestionText } from "@/server/askmore_v2/agents/utils";
import { generateMicroConfirmation } from "@/server/askmore_v2/services/micro-confirm-generator";
import { createPendingCommitment } from "@/server/askmore_v2/runtime/pending-commitments";
import { logAskmoreRuntime } from "@/server/askmore_v2/runtime/runtime-logger";

export async function runClarificationAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const state = cloneRuntimeState(input.session.state_jsonb);
  ensureRuntimeStateDefaults(state);

  const now = new Date().toISOString();
  const activeQuestionId = input.context.active_question.question_id;
  const questionText = inferCurrentQuestionText(input);
  const targetGap = input.context.unresolved_gaps[0];
  const userSnippet = input.userMessage.trim().replace(/\s+/g, " ").slice(0, 48);
  const targetDimensionId = targetGap?.dimension_id
    ?? input.context.active_question.node?.target_dimensions[0]?.id
    ?? null;
  const targetDimensionLabel = targetGap?.label
    ?? (targetDimensionId
      ? input.context.active_question.node?.target_dimensions.find((item) => item.id === targetDimensionId)?.label ?? targetDimensionId
      : (input.language === "zh" ? "关键点" : "key point"));
  logAskmoreRuntime("clarification_agent_start", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    user_message: input.userMessage,
    target_dimension_id: targetDimensionId,
    target_dimension_label: targetDimensionLabel,
  });

  let options = undefined;
  let allowFreeText: boolean | undefined;
  let clarifyPrompt = input.language === "zh"
    ? "我理解你是在确认定义，我先用一个小确认把意思对齐。"
    : "You are asking for clarification. I will align meaning with one quick confirmation.";

  if (targetDimensionId) {
    const nodeRuntime = activeQuestionId ? state.node_runtime[activeQuestionId] : undefined;
    const currentEvidence = (nodeRuntime?.dimension_answered_evidence?.[targetDimensionId] ?? input.userMessage).slice(0, 120);
    const generated = await generateMicroConfirmation({
      language: input.language,
      dimensionId: targetDimensionId,
      dimensionLabel: targetDimensionLabel,
      userEvidence: currentEvidence,
      candidateValue: nodeRuntime?.captured_dimensions?.[targetDimensionId] ?? null,
      unresolvedReason: nodeRuntime?.dimension_unresolved_reason?.[targetDimensionId] ?? null,
    });
    options = generated.options;
    allowFreeText = generated.allow_free_text;
    clarifyPrompt = questionText
      ? questionText
      : generated.ack_text;

    if (activeQuestionId && nodeRuntime) {
      if (!nodeRuntime.dimension_state) nodeRuntime.dimension_state = {};
      if (!nodeRuntime.dimension_unresolved_reason) nodeRuntime.dimension_unresolved_reason = {};
      if (!nodeRuntime.dimension_micro_confirmed) nodeRuntime.dimension_micro_confirmed = {};
      nodeRuntime.dimension_state[targetDimensionId] = "micro_confirm_pending";
      nodeRuntime.dimension_micro_confirmed[targetDimensionId] = true;
      nodeRuntime.last_micro_confirm_offer = {
        dimension_id: targetDimensionId,
        options: generated.options,
        offered_at_turn: input.session.turn_count + 1,
      };
    }
    createPendingCommitment({
      state,
      type: "micro_confirm",
      questionId: activeQuestionId,
      dimensionId: targetDimensionId,
      note: "clarification_agent_micro_confirm",
      now,
      turnIndex: input.session.turn_count + 1,
    });
    logAskmoreRuntime("clarification_agent_commitment_created", {
      session_id: input.sessionId,
      question_id: activeQuestionId,
      type: "micro_confirm",
      dimension_id: targetDimensionId,
    });
  }

  const events = [
    emitVisibleEvent({
      event_type: "understanding_summary",
      content: input.language === "zh"
        ? `我理解你是在确认表述口径（你刚刚说的是：${userSnippet || "需要澄清"}）。我先做一个小确认，避免我们理解错位。`
        : `I understand you are checking wording alignment (you just said: ${userSnippet || "you need clarification"}). I will run one quick confirmation to avoid misalignment.`,
      created_at: now,
    }),
    emitVisibleEvent({
      event_type: "micro_confirm",
      content: clarifyPrompt,
      options,
      dimension_id: targetDimensionId ?? undefined,
      allow_free_text: allowFreeText,
      mode: "micro_confirm",
      badge_label: input.language === "zh" ? "快速确认" : "Quick confirm",
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

  state.session.pending_intent = "clarify_meaning";
  state.session.last_understanding_feedback = input.language === "zh"
    ? `我理解你是在确认表述口径（你刚刚说的是：${userSnippet || "需要澄清"}）。`
    : `I understand you are checking wording alignment (you just said: ${userSnippet || "you need clarification"}).`;
  state.recent_user_turns = [...(state.recent_user_turns ?? []), input.userMessage].slice(-8);
  if (activeQuestionId) {
    state.session.current_question_id = activeQuestionId;
  }

  const nextQuestion = questionText
    ? {
        question_id: activeQuestionId,
        question_text: questionText,
      }
    : null;
  logAskmoreRuntime("clarification_agent_end", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    next_question: nextQuestion?.question_id ?? null,
    has_options: Array.isArray(options) && options.length > 0,
    event_types: events.map((event) => event.event_type),
  });

  return {
    state,
    status: input.session.status,
    turn_count: input.session.turn_count + 1,
    events,
    next_question: nextQuestion,
    messages_already_persisted: false,
    task_module: "ClarificationAgent",
    transition_reason: "clarification_agent_micro_confirm",
  };
}
