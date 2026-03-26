import { AgentRunInput, AgentRunOutput } from "@/server/askmore_v2/agents/contracts";
import { ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";
import { generateHelpCoaching } from "@/server/askmore_v2/services/help-coaching";
import { cloneRuntimeState, emitVisibleEvent, inferCurrentQuestionText } from "@/server/askmore_v2/agents/utils";
import { logAskmoreRuntime } from "@/server/askmore_v2/runtime/runtime-logger";

export async function runHelpAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const state = cloneRuntimeState(input.session.state_jsonb);
  ensureRuntimeStateDefaults(state);

  const now = new Date().toISOString();
  const questionText = inferCurrentQuestionText(input);
  const activeQuestionId = input.context.active_question.question_id;
  const missingPoints = input.context.unresolved_gaps.map((item) => item.label);
  const reconnectTargetGap = input.context.unresolved_gaps[0]?.label ?? null;
  const userSnippet = input.userMessage.trim().replace(/\s+/g, " ").slice(0, 48);
  const questionScopedContext = Object.entries(input.context.structured_knowledge)
    .filter(([key]) => (activeQuestionId ? key.startsWith(`${activeQuestionId}__`) : true))
    .map(([, value]) => String(value))
    .slice(0, 6);
  logAskmoreRuntime("help_agent_start", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    user_message: input.userMessage,
    unresolved_gap_count: input.context.unresolved_gaps.length,
  });

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
        `我先直接回应你这个疑问：${coaching.direct_help_answer}`,
        coaching.explanatory_examples.length > 0 ? `你可以先看这两个观察点：${coaching.explanatory_examples.join("；")}` : "",
        `我先把问题降级成更容易回答的版本：${coaching.downgraded_question}`,
      ].filter(Boolean).join("\n")
    : [
        `I will first answer your immediate question: ${coaching.direct_help_answer}`,
        coaching.explanatory_examples.length > 0 ? `You can focus on these observation cues first: ${coaching.explanatory_examples.join("; ")}` : "",
        `I will now reframe this into an easier form: ${coaching.downgraded_question}`,
      ].filter(Boolean).join("\n");

  const transition = input.language === "zh"
    ? `${coaching.reconnect_prompt} 我们先不跳题，先把这一题补清楚。`
    : `${coaching.reconnect_prompt} We will stay on this question before moving ahead.`;

  const events = [
    emitVisibleEvent({
      event_type: "understanding_summary",
      content: input.language === "zh"
        ? `我理解你现在卡住的是“${userSnippet || "怎么回答"}”这个点。我先把这个疑问解开，再带你回到这题继续答。`
        : `I understand you are stuck on "${userSnippet || "how to answer"}". I will resolve this first, then guide you back to the main question.`,
      created_at: now,
    }),
    emitVisibleEvent({
      event_type: "help_explanation",
      content: explanation,
      created_at: now,
    }),
  ];

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
      content: transition,
      created_at: now,
    }),
  );
  if (questionText) {
    events.push(
      emitVisibleEvent({
        event_type: "next_question",
        content: coaching.downgraded_question,
        created_at: now,
      }),
    );
  }

  state.session.pending_intent = "ask_for_help";
  if (activeQuestionId) {
    state.session.current_question_id = activeQuestionId;
  }
  state.session.last_understanding_feedback = input.language === "zh"
    ? `我理解你现在卡住的是“${userSnippet || "怎么回答"}”这个点。`
    : `I understand you are currently stuck on "${userSnippet || "how to answer"}".`;
  state.session.last_missing_points = missingPoints;
  state.recent_user_turns = [...(state.recent_user_turns ?? []), input.userMessage].slice(-8);
  state.runtime_meta = {
    ...(state.runtime_meta ?? {}),
    last_help_obstacle_layer: coaching.obstacle_layer,
    last_help_resolution_goal: coaching.resolution_goal,
    last_help_reconnect_target: reconnectTargetGap ?? undefined,
  };

  const nextQuestion = questionText
    ? {
        question_id: activeQuestionId,
        question_text: coaching.downgraded_question,
      }
    : null;
  logAskmoreRuntime("help_agent_end", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    obstacle_layer: coaching.obstacle_layer,
    resolution_goal: coaching.resolution_goal,
    reconnect_target_gap: reconnectTargetGap,
    produced_examples: coaching.answer_examples.length,
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
    task_module: "HelpAgent",
    transition_reason: "help_agent_stay_on_current_question",
  };
}
