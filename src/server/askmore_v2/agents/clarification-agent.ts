import { AgentRunInput, AgentRunOutput } from "@/server/askmore_v2/agents/contracts";
import { generateHelpCoaching } from "@/server/askmore_v2/services/help-coaching";
import { routeClarifySubtype } from "@/server/askmore_v2/services/clarify-subtype-router";
import { ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";
import { cloneRuntimeState, emitVisibleEvent, inferCurrentQuestionText } from "@/server/askmore_v2/agents/utils";
import { generateMicroConfirmation } from "@/server/askmore_v2/services/micro-confirm-generator";
import { createPendingCommitment } from "@/server/askmore_v2/runtime/pending-commitments";
import { logAskmoreRuntime } from "@/server/askmore_v2/runtime/runtime-logger";
import { AskmoreV2ConfirmedReferent } from "@/server/askmore_v2/types";

function pickReferent(input: AgentRunInput): AskmoreV2ConfirmedReferent | null {
  if (input.context.cross_question_anchor) return input.context.cross_question_anchor;
  return input.context.recent_confirmed_referents[0] ?? null;
}

function buildReferentResolvedText(params: {
  language: AgentRunInput["language"];
  referent: AskmoreV2ConfirmedReferent | null;
}): string {
  if (params.language === "zh") {
    if (!params.referent) {
      return "我先说清楚：我这里指的是你前面提到的那个状态，不是让你说一个全新的状态。";
    }
    return `我先说清楚：我这里指的是你前面提到的「${params.referent.value}」这个状态，不是新的状态。`;
  }
  if (!params.referent) {
    return "Let me clarify first: I am referring to the state you mentioned earlier, not a brand-new one.";
  }
  return `Let me clarify first: I am referring to the state you mentioned earlier ("${params.referent.value}"), not a new one.`;
}

function buildReturnMainlineText(params: {
  language: AgentRunInput["language"];
  questionText: string | null;
}): string {
  if (params.questionText) return params.questionText;
  return params.language === "zh"
    ? "我们回到当前这题，继续把时间线补清楚。"
    : "Let's return to the current question and clarify the timeline.";
}

export async function runClarificationAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const state = cloneRuntimeState(input.session.state_jsonb);
  ensureRuntimeStateDefaults(state);

  const now = new Date().toISOString();
  const activeQuestionId = input.context.active_question.question_id;
  const questionText = inferCurrentQuestionText(input);
  const targetGap = input.context.unresolved_gaps[0];
  const userSnippet = input.userMessage.trim().replace(/\s+/g, " ").slice(0, 48);
  const subtype = await routeClarifySubtype({
    userMessage: input.userMessage,
    context: input.context,
  });
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
    clarify_subtype: subtype.subtype,
    subtype_confidence: subtype.confidence,
    subtype_rationale: subtype.rationale,
  });

  const events = [] as AgentRunOutput["events"];
  let nextQuestion: AgentRunOutput["next_question"] = null;
  let transitionReason = "clarification_value_micro_confirm";
  let resolvedReferent: AskmoreV2ConfirmedReferent | null = null;

  if (subtype.subtype === "referent_clarify") {
    resolvedReferent = pickReferent(input);
    events.push(
      emitVisibleEvent({
        event_type: "understanding_summary",
        content: buildReferentResolvedText({
          language: input.language,
          referent: resolvedReferent,
        }),
        created_at: now,
      }),
    );
    const resumeQuestion = buildReturnMainlineText({
      language: input.language,
      questionText,
    });
    events.push(
      emitVisibleEvent({
        event_type: "transition_summary",
        content: input.language === "zh"
          ? "我们沿着这个同一个状态继续，我接下来问的是它从什么时候开始出现。"
          : "We will continue on this same state, and I will ask when it started.",
        created_at: now,
      }),
    );
    events.push(
      emitVisibleEvent({
        event_type: "next_question",
        content: resumeQuestion,
        created_at: now,
      }),
    );
    nextQuestion = {
      question_id: activeQuestionId,
      question_text: resumeQuestion,
    };
    transitionReason = "clarification_referent_resolved_then_return_mainline";
  } else if (subtype.subtype === "concept_clarify") {
    const missingPoints = input.context.unresolved_gaps.map((item) => item.label);
    const reconnectTargetGap = input.context.unresolved_gaps[0]?.label ?? null;
    const questionScopedContext = Object.entries(input.context.structured_knowledge)
      .filter(([key]) => (activeQuestionId ? key.startsWith(`${activeQuestionId}__`) : true))
      .map(([, value]) => String(value))
      .slice(0, 6);
    const coaching = await generateHelpCoaching({
      language: input.language,
      userHelpQuery: input.userMessage,
      activeQuestion: questionText ?? (input.language === "zh" ? "当前问题" : "current question"),
      gapHints: missingPoints.slice(0, 3),
      knownContext: questionScopedContext,
      scenario: input.flow.scenario,
      targetOutputType: input.flow.target_output_type,
    });
    const explanation = input.language === "zh"
      ? [
          `我先直接解释你卡住的这个点：${coaching.direct_help_answer}`,
          coaching.explanatory_examples.length > 0 ? `你可以先按这个观察框架看：${coaching.explanatory_examples.join("；")}` : "",
          `我先把问题降级成更容易回答的版本：${coaching.downgraded_question}`,
        ].filter(Boolean).join("\n")
      : [
          `I will first explain the point you are stuck on: ${coaching.direct_help_answer}`,
          coaching.explanatory_examples.length > 0 ? `You can use this observation frame first: ${coaching.explanatory_examples.join("; ")}` : "",
          `I will reframe it into an easier version: ${coaching.downgraded_question}`,
        ].filter(Boolean).join("\n");
    events.push(
      emitVisibleEvent({
        event_type: "understanding_summary",
        content: input.language === "zh"
          ? `我理解你现在卡在“${userSnippet || "概念怎么理解"}”这个点，我先把标准讲清楚再继续。`
          : `I understand you are stuck on "${userSnippet || "the concept itself"}". I will clarify the criteria first and then continue.`,
        created_at: now,
      }),
    );
    events.push(
      emitVisibleEvent({
        event_type: "help_explanation",
        content: explanation,
        created_at: now,
      }),
    );
    if (coaching.answer_examples.length > 0) {
      events.push(
        emitVisibleEvent({
          event_type: "help_examples",
          items: coaching.answer_examples.slice(0, 2),
          created_at: now,
        }),
      );
    }
    events.push(
      emitVisibleEvent({
        event_type: "transition_summary",
        content: input.language === "zh"
          ? `${coaching.reconnect_prompt} 我们先不跳题，先把这一题补清楚。`
          : `${coaching.reconnect_prompt} We will stay on this question before moving ahead.`,
        created_at: now,
      }),
    );
    events.push(
      emitVisibleEvent({
        event_type: "next_question",
        content: coaching.downgraded_question,
        created_at: now,
      }),
    );
    nextQuestion = {
      question_id: activeQuestionId,
      question_text: coaching.downgraded_question,
    };
    state.runtime_meta = {
      ...(state.runtime_meta ?? {}),
      last_help_obstacle_layer: coaching.obstacle_layer,
      last_help_resolution_goal: coaching.resolution_goal,
      last_help_reconnect_target: reconnectTargetGap ?? undefined,
    };
    transitionReason = "clarification_concept_explained_then_return_mainline";
  } else {
    let options = undefined;
    let allowFreeText: boolean | undefined;
    let clarifyPrompt = input.language === "zh"
      ? "我先做一个小确认，避免我们理解错位。"
      : "I will run one small confirmation to avoid misalignment.";

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
      clarifyPrompt = generated.ack_text;

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
    events.push(
      emitVisibleEvent({
        event_type: "understanding_summary",
        content: input.language === "zh"
          ? `我理解你是在确认具体取值（你刚刚说的是：${userSnippet || "需要澄清"}），我先对齐一个点再继续。`
          : `I understand you are clarifying the exact value (you said: ${userSnippet || "needs clarification"}), so I will align one point first.`,
        created_at: now,
      }),
    );
    events.push(
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
    );
  }

  state.session.pending_intent = "clarify_meaning";
  state.session.last_understanding_feedback = events[0]?.payload.content ?? null;
  state.recent_user_turns = [...(state.recent_user_turns ?? []), input.userMessage].slice(-8);
  if (activeQuestionId) {
    state.session.current_question_id = activeQuestionId;
  }
  state.runtime_meta = {
    ...(state.runtime_meta ?? {}),
    last_clarify_subtype: subtype.subtype,
    last_resolved_referent: resolvedReferent?.value,
    last_referent_source: resolvedReferent?.source,
  };
  logAskmoreRuntime("clarification_agent_end", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    clarify_subtype: subtype.subtype,
    resolved_referent: resolvedReferent?.value ?? null,
    referent_source: resolvedReferent?.source ?? null,
    next_question: nextQuestion?.question_id ?? null,
    has_options: events.some((event) => (event.payload.options ?? []).length > 0),
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
    transition_reason: transitionReason,
  };
}
