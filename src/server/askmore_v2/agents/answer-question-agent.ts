import {
  AskmoreV2FlowQuestion,
  AskmoreV2NodeRuntimeState,
  AskmoreV2QuestionNode,
  AskmoreV2QuestionProgress,
  AskmoreV2TurnExtractorOutput,
} from "@/server/askmore_v2/types";
import { AgentRunInput, AgentRunOutput } from "@/server/askmore_v2/agents/contracts";
import { cloneRuntimeState, emitVisibleEvent } from "@/server/askmore_v2/agents/utils";
import { ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";
import { extractFactsFromTurn } from "@/server/askmore_v2/actions/extract-facts";
import { applyExtractorToCoverage } from "@/server/askmore_v2/actions/update-dimension-coverage";
import { generateCoverageSummary, generateUnderstandingSummary } from "@/server/askmore_v2/actions/generate-understanding-summary";
import { buildQuestionPrompt, findNextQuestionId } from "@/server/askmore_v2/actions/emit-next-question";
import { evaluateRepetitionPolicy } from "@/server/askmore_v2/runtime/policies/repetition-policy";
import { evaluateCoveragePolicy } from "@/server/askmore_v2/runtime/policies/coverage-policy";
import { decideAdvanceOrFollowUp } from "@/server/askmore_v2/actions/decide-advance-or-followup";
import { generateFollowUpOptions } from "@/server/askmore_v2/services/follow-up-option-generator";
import {
  createPendingCommitment,
  getOpenCommitments,
  resolvePendingCommitments,
} from "@/server/askmore_v2/runtime/pending-commitments";
import { logAskmoreRuntime } from "@/server/askmore_v2/runtime/runtime-logger";

const FOLLOW_UP_BUDGET = 4;

function buildFallbackNode(question: AskmoreV2FlowQuestion): AskmoreV2QuestionNode {
  const dims = question.sub_questions.map((subQuestion, index) => ({
    id: `${question.question_id}__dimension_topic_${index + 1}`,
    label: subQuestion,
  }));
  const completion = (dims.slice(0, Math.min(2, Math.max(1, dims.length))).map((item) => item.id));
  return {
    question_id: question.question_id,
    goal: question.original_question,
    user_facing_entry: question.entry_question,
    target_dimensions: dims,
    completion_criteria: completion.length > 0 ? completion : dims.map((item) => item.id),
    hypothesis_templates: [],
    node_summary_template: "",
  };
}

function buildFallbackNodeRuntime(questionId: string): AskmoreV2NodeRuntimeState {
  return {
    question_id: questionId,
    captured_dimensions: {},
    dimension_confidence: {},
    dimension_soft_confidence: {},
    dimension_state: {},
    dimension_unresolved_reason: {},
    dimension_answered: {},
    dimension_answered_evidence: {},
    dimension_micro_confirmed: {},
    dimension_priority_current: {},
    dimension_priority_candidate: {},
    dimension_priority_streak: {},
    dimension_priority_reason: {},
    dimension_priority_downgraded_by_limit: {},
    clarify_count: 0,
    node_status: "not_started",
    candidate_hypothesis: null,
    last_node_summary: null,
    contradiction_detected: false,
    last_micro_confirm_offer: null,
  };
}

function buildFallbackQuestionProgress(question: AskmoreV2FlowQuestion): AskmoreV2QuestionProgress {
  return {
    question_id: question.question_id,
    status: "empty",
    times_asked: 0,
    follow_up_count: 0,
    sub_questions_completed: [],
    sub_questions_remaining: [...question.sub_questions],
    coverage_score: 0,
  };
}

function dimensionLabel(node: AskmoreV2QuestionNode, dimensionId: string | null): string {
  if (!dimensionId) return "";
  return node.target_dimensions.find((item) => item.id === dimensionId)?.label ?? dimensionId;
}

function pickGapDimension(params: {
  node: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  recentDimensionPrompts: string[];
  prioritizeMust: boolean;
}): string | null {
  const unresolved = params.node.target_dimensions
    .map((item) => item.id)
    .filter((dimensionId) => Number(params.nodeRuntime.dimension_confidence[dimensionId] ?? 0) < 0.6);
  if (unresolved.length === 0) return null;

  const mustSet = new Set(params.node.completion_criteria);
  const preferred = params.prioritizeMust
    ? unresolved.filter((dimensionId) => mustSet.has(dimensionId))
    : unresolved;
  const pool = preferred.length > 0 ? preferred : unresolved;

  const filtered = pool.filter((dimensionId) => {
    const key = `${params.node.question_id}::${dimensionId}`;
    return !params.recentDimensionPrompts.slice(-2).includes(key);
  });

  return filtered[0] ?? pool[0] ?? null;
}

function buildFollowUpQuestion(params: {
  language: "zh" | "en";
  node: AskmoreV2QuestionNode;
  dimensionId: string | null;
}): string | null {
  if (!params.dimensionId) return null;
  const label = dimensionLabel(params.node, params.dimensionId);
  if (params.language === "zh") {
    return `为了把这题补齐，我想先了解一下：${label}。`;
  }
  return `To complete this question, I want to understand one point: ${label}.`;
}

function normalizeCompareText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?;；:："'`~\-_/()（）[\]{}]/g, "");
}

function trimFactValue(value: string, max = 42): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function buildStateUpdateEntries(params: {
  node: AskmoreV2QuestionNode;
  extractor: AskmoreV2TurnExtractorOutput;
  updatedDimensions: string[];
}): string[] {
  return params.updatedDimensions.slice(0, 3).map((dimensionId) => {
    const label = dimensionLabel(params.node, dimensionId);
    const rawValue = params.extractor.facts_extracted[dimensionId]?.value?.trim() ?? "";
    if (!rawValue) return label;
    const snippet = trimFactValue(rawValue);
    if (!snippet) return label;
    if (normalizeCompareText(snippet) === normalizeCompareText(label)) return label;
    return `${label}=${snippet}`;
  });
}

function buildUnresolvedGapSnapshot(params: {
  node: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
}) {
  return params.node.target_dimensions
    .map((dimension) => {
      const confidence = Number(params.nodeRuntime.dimension_confidence[dimension.id] ?? 0);
      if (confidence >= 0.6) return null;
      const reason = params.nodeRuntime.dimension_unresolved_reason?.[dimension.id] ?? "semantic_unmapped";
      const isMust = params.node.completion_criteria.includes(dimension.id);
      return {
        dimension_id: dimension.id,
        label: dimension.label,
        reason,
        severity: isMust ? "high" as const : "medium" as const,
        actionable: true,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function looksLikeClarificationTurn(text: string): boolean {
  return /(你问的是|你是问|是.+还是|还是.+还是|到底是|我理解的是|我想确认一下)/i.test(text);
}

function resolveExtractionHintDimension(params: {
  questionId: string;
  node: AskmoreV2QuestionNode;
  recentDimensionPrompts: string[];
  openFollowUpCommitments: Array<{ dimension_id?: string | null }>;
}): string | null {
  const validIds = new Set(params.node.target_dimensions.map((item) => item.id));

  for (let i = params.recentDimensionPrompts.length - 1; i >= 0; i -= 1) {
    const token = params.recentDimensionPrompts[i];
    const [questionId, dimensionId] = token.split("::");
    if (questionId !== params.questionId) continue;
    if (dimensionId && validIds.has(dimensionId)) return dimensionId;
  }

  for (let i = params.openFollowUpCommitments.length - 1; i >= 0; i -= 1) {
    const dimensionId = params.openFollowUpCommitments[i].dimension_id;
    if (dimensionId && validIds.has(dimensionId)) return dimensionId;
  }

  return null;
}

export async function runAnswerQuestionAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const state = cloneRuntimeState(input.session.state_jsonb);
  ensureRuntimeStateDefaults(state);

  const now = new Date().toISOString();
  const nextTurnCount = input.session.turn_count + 1;
  const activeQuestionId = input.context.active_question.question_id ?? state.session.current_question_id;
  const activeQuestion = activeQuestionId
    ? input.flow.questions.find((item) => item.question_id === activeQuestionId) ?? null
    : null;
  logAskmoreRuntime("answer_agent_start", {
    session_id: input.sessionId,
    turn_count_before: input.session.turn_count,
    question_id: activeQuestionId,
    has_choice: Boolean(input.choice),
    user_message: input.userMessage,
  });

  if (!activeQuestionId || !activeQuestion) {
    const events = [
      emitVisibleEvent({
        event_type: "transition_summary",
        content: input.language === "zh" ? "当前没有可继续的问题，访谈结束。" : "No more questions to continue. Interview completed.",
        created_at: now,
      }),
    ];
    state.session.finalized = true;
    state.session.current_question_id = null;
    state.session.pending_intent = "answer_question";
    return {
      state,
      status: "completed",
      turn_count: nextTurnCount,
      events,
      next_question: null,
      messages_already_persisted: false,
      task_module: "AnswerQuestionAgent",
      transition_reason: "no_active_question_end_interview",
    };
  }

  const node = state.nodes[activeQuestionId] ?? buildFallbackNode(activeQuestion);
  state.nodes[activeQuestionId] = node;
  const nodeRuntime = state.node_runtime[activeQuestionId] ?? buildFallbackNodeRuntime(activeQuestionId);
  state.node_runtime[activeQuestionId] = nodeRuntime;
  const progress = state.question_progress[activeQuestionId] ?? buildFallbackQuestionProgress(activeQuestion);
  state.question_progress[activeQuestionId] = progress;

  const openFollowUpCommitmentsForHint = getOpenCommitments({
    state,
    questionId: activeQuestionId,
    type: "follow_up",
  });
  const extractionHintDimensionId = resolveExtractionHintDimension({
    questionId: activeQuestionId,
    node,
    recentDimensionPrompts: state.recent_dimension_prompts,
    openFollowUpCommitments: openFollowUpCommitmentsForHint,
  });

  const extractor = await extractFactsFromTurn({
    language: input.language,
    node,
    nodeRuntime,
    userMessage: input.userMessage,
    choice: input.choice,
    hintDimensionId: extractionHintDimensionId,
  });
  logAskmoreRuntime("answer_agent_extractor", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    hinted_dimension_id: extractionHintDimensionId,
    answer_quality: extractor.answer_quality,
    confidence_overall: extractor.confidence_overall,
    updated_dimensions: extractor.updated_dimensions,
    facts_extracted: Object.keys(extractor.facts_extracted),
  });

  const coverageUpdate = applyExtractorToCoverage({
    state,
    questionId: activeQuestionId,
    node,
    nodeRuntime,
    extractor,
    now,
  });
  logAskmoreRuntime("answer_agent_coverage_update", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    updated_dimensions: coverageUpdate.updatedDimensions,
    covered_must_count: coverageUpdate.coveredMustCount,
    required_must_count: coverageUpdate.requiredMustCount,
    unresolved_dimensions: coverageUpdate.unresolvedDimensionIds,
  });

  let resolvedCommitments = 0;
  for (const dimensionId of coverageUpdate.updatedDimensions) {
    resolvedCommitments += resolvePendingCommitments({
      state,
      now,
      turnIndex: nextTurnCount,
      questionId: activeQuestionId,
      dimensionId,
      reason: "user_provided_answer",
    });
  }
  if (resolvedCommitments > 0) {
    logAskmoreRuntime("answer_agent_commitments_resolved", {
      session_id: input.sessionId,
      question_id: activeQuestionId,
      resolved_count: resolvedCommitments,
    });
  }

  const candidateDimensionId = pickGapDimension({
    node,
    nodeRuntime,
    recentDimensionPrompts: state.recent_dimension_prompts,
    prioritizeMust: true,
  });

  const repetitionDecision = evaluateRepetitionPolicy({
    userMessage: input.userMessage,
    recentPrompts: state.recent_dimension_prompts,
    candidateDimensionId,
  });

  const openCommitments = getOpenCommitments({
    state,
    questionId: activeQuestionId,
  });
  const hasPendingClarificationCommitment = openCommitments.some(
    (item) => item.type === "micro_confirm" || item.type === "pending_correction",
  );
  const ambiguousClarificationSignal = looksLikeClarificationTurn(input.userMessage);

  const coverageDecision = evaluateCoveragePolicy({
    covered: coverageUpdate.coveredMustCount,
    required: coverageUpdate.requiredMustCount,
    mustCovered: coverageUpdate.coveredMustCount,
    mustRequired: coverageUpdate.requiredMustCount,
    unresolvedGaps: buildUnresolvedGapSnapshot({
      node,
      nodeRuntime,
    }),
    pendingCommitments: openCommitments,
  });
  logAskmoreRuntime("answer_agent_policy_coverage", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    must_covered: coverageDecision.must_covered_count,
    must_required: coverageDecision.must_required_count,
    must_remaining: coverageDecision.must_remaining_count,
    can_wrap_up: coverageDecision.can_wrap_up,
    pending_commitments: coverageDecision.blocking_pending_commitments.length,
    prioritized_gap: coverageDecision.prioritized_gap?.dimension_id ?? null,
  });

  const nextQuestionId = findNextQuestionId(input.flow.questions, activeQuestionId);
  const canEnd = coverageDecision.can_wrap_up && !nextQuestionId;

  const progressionDecision = decideAdvanceOrFollowUp({
    coverage: coverageDecision,
    repetition: repetitionDecision,
    hasPendingClarificationCommitment: hasPendingClarificationCommitment || ambiguousClarificationSignal,
    followUpCount: progress.follow_up_count,
    followUpBudget: FOLLOW_UP_BUDGET,
    hasNextQuestion: Boolean(nextQuestionId),
    canEndInterview: canEnd,
  });
  logAskmoreRuntime("answer_agent_policy_progression", {
    session_id: input.sessionId,
    question_id: activeQuestionId,
    repetition: repetitionDecision,
    move: progressionDecision.move,
    reason: progressionDecision.reason,
    follow_up_count: progress.follow_up_count,
    follow_up_budget: FOLLOW_UP_BUDGET,
  });

  progress.times_asked += 1;
  progress.coverage_score = Math.max(0, Math.min(1, coverageDecision.must_covered_count / Math.max(1, coverageDecision.must_required_count)));
  state.session.pending_intent = "answer_question";
  state.recent_user_turns = [...(state.recent_user_turns ?? []), input.userMessage].slice(-8);
  const completionSet = new Set(node.completion_criteria);
  const missingMustLabels = node.target_dimensions
    .filter((dimension) => completionSet.has(dimension.id))
    .filter((dimension) => Number(nodeRuntime.dimension_confidence[dimension.id] ?? 0) < 0.6)
    .map((dimension) => dimension.label);
  state.session.last_missing_points = missingMustLabels;
  const knownFacts = Object.entries(nodeRuntime.captured_dimensions ?? {})
    .map(([dimensionId, value]) => ({
      label: dimensionLabel(node, dimensionId),
      value: String(value ?? "").trim(),
    }))
    .filter((item) => Boolean(item.value))
    .slice(0, 5);
  const recentMessages = (input.context.recent_memory.message_snippets ?? [])
    .map((item) => ({
      role: item.role,
      message: item.message,
    }))
    .slice(-4);

  const understandingSummary = await generateUnderstandingSummary({
    language: input.language,
    node,
    extractor,
    fallback: input.userMessage,
    recentTurns: input.context.recent_memory.user_turns,
    recentMessages,
    knownFacts,
    missingHints: missingMustLabels.slice(0, 3),
  });

  const events = [
    emitVisibleEvent({
      event_type: "understanding_summary",
      content: understandingSummary,
      created_at: now,
    }),
  ];

  if (coverageUpdate.updatedDimensions.length > 0) {
    const entries = buildStateUpdateEntries({
      node,
      extractor,
      updatedDimensions: coverageUpdate.updatedDimensions,
    });
    events.push(
      emitVisibleEvent({
        event_type: "state_update",
        content: input.language === "zh" ? `已记录：${entries.join("；")}` : `Recorded: ${entries.join("; ")}`,
        created_at: now,
      }),
    );
  }

  events.push(
    emitVisibleEvent({
      event_type: "coverage_summary",
      content: generateCoverageSummary({
        language: input.language,
        covered: coverageDecision.must_covered_count,
        required: coverageDecision.must_required_count,
      }),
      created_at: now,
    }),
  );

  let nextQuestionPayload: AgentRunOutput["next_question"] = null;
  let transitionReason = progressionDecision.reason;
  let handoffIntent: AgentRunOutput["handoff_intent"] = undefined;

  const shouldEmitGapNotice = (
    progressionDecision.move === "ask_follow_up"
    || progressionDecision.move === "stay_on_question"
    || progressionDecision.move === "stay_on_question_blocked"
    || progressionDecision.move === "handoff_clarification"
  ) && missingMustLabels.length > 0;

  if (shouldEmitGapNotice) {
    events.push(
      emitVisibleEvent({
        event_type: "gap_notice",
        content: input.language === "zh"
          ? `还缺的关键点：${missingMustLabels.slice(0, 3).join("、")}`
          : `Still missing key points: ${missingMustLabels.slice(0, 3).join(", ")}`,
        created_at: now,
      }),
    );
  }

  if (progressionDecision.move === "handoff_clarification") {
    events.push(
      emitVisibleEvent({
        event_type: "transition_summary",
        content: input.language === "zh"
          ? "这条回复里有歧义，我先做一个小确认再继续。"
          : "There is ambiguity in this reply. I will run one quick clarification first.",
        created_at: now,
      }),
    );
    state.session.pending_intent = "clarify_meaning";
    handoffIntent = "clarify_meaning";
    progress.status = "partial";
  } else if (progressionDecision.move === "ask_follow_up" || progressionDecision.move === "stay_on_question") {
    const followUpDimensionId = pickGapDimension({
      node,
      nodeRuntime,
      recentDimensionPrompts: state.recent_dimension_prompts,
      prioritizeMust: true,
    });

    if (followUpDimensionId) {
      createPendingCommitment({
        state,
        type: "follow_up",
        questionId: activeQuestionId,
        dimensionId: followUpDimensionId,
        note: "await_follow_up",
        now,
        turnIndex: nextTurnCount,
      });
      logAskmoreRuntime("answer_agent_commitment_created", {
        session_id: input.sessionId,
        question_id: activeQuestionId,
        type: "follow_up",
        dimension_id: followUpDimensionId,
      });
      state.recent_dimension_prompts = [...(state.recent_dimension_prompts ?? []), `${activeQuestionId}::${followUpDimensionId}`].slice(-12);
      progress.follow_up_count += 1;
    }

    const followUpQuestion = buildFollowUpQuestion({
      language: input.language,
      node,
      dimensionId: followUpDimensionId,
    });
    const followUpOptions = followUpDimensionId
      ? await generateFollowUpOptions({
          language: input.language,
          activeQuestionText: node.user_facing_entry || activeQuestion.entry_question,
          dimensionLabel: dimensionLabel(node, followUpDimensionId),
          gapHints: missingMustLabels,
          userMessage: input.userMessage,
        })
      : null;
    events.push(
      emitVisibleEvent({
        event_type: "transition_summary",
        content: input.language === "zh" ? "我们先留在当前题，把关键缺口补齐。" : "Let's stay on this question and close the key gaps first.",
        created_at: now,
      }),
    );
    if (followUpQuestion) {
      events.push(
        emitVisibleEvent({
          event_type: "next_question",
          content: followUpQuestion,
          options: followUpOptions ?? undefined,
          dimension_id: followUpDimensionId ?? undefined,
          allow_free_text: true,
          mode: followUpOptions && followUpOptions.length > 0 ? "follow_up_select" : undefined,
          badge_label: followUpOptions && followUpOptions.length > 0
            ? (input.language === "zh" ? "普通追问" : "Follow-up")
            : undefined,
          created_at: now,
        }),
      );
      nextQuestionPayload = {
        question_id: activeQuestionId,
        question_text: followUpQuestion,
      };
    }
    progress.status = "partial";
  } else if (progressionDecision.move === "stay_on_question_blocked") {
    events.push(
      emitVisibleEvent({
        event_type: "transition_summary",
        content: input.language === "zh"
          ? "这一题我先不重复追问了，我会基于已记录内容做收束判断。"
          : "I will avoid repeating this question and proceed with a closure check from what is already captured.",
        created_at: now,
      }),
    );
    progress.status = coverageDecision.must_remaining_count === 0 ? "completed" : "partial";
  } else if (progressionDecision.move === "advance_next_question") {
    progress.status = "completed";
    const nextQuestion = nextQuestionId
      ? input.flow.questions.find((item) => item.question_id === nextQuestionId) ?? null
      : null;
    const nextNode = nextQuestionId ? state.nodes[nextQuestionId] ?? null : null;
    const nextPrompt = buildQuestionPrompt({
      question: nextQuestion,
      node: nextNode,
    });

    events.push(
      emitVisibleEvent({
        event_type: "transition_summary",
        content: input.language === "zh" ? "这一题关键信息已够用，我们进入下一题。" : "This question has enough key information. Moving to the next one.",
        created_at: now,
      }),
    );

    if (nextQuestionId && nextPrompt) {
      state.session.current_question_id = nextQuestionId;
      events.push(
        emitVisibleEvent({
          event_type: "next_question",
          content: nextPrompt,
          created_at: now,
        }),
      );
      nextQuestionPayload = {
        question_id: nextQuestionId,
        question_text: nextPrompt,
      };
    }
  } else if (progressionDecision.move === "end_interview") {
    progress.status = "completed";
    state.session.current_question_id = null;
    state.session.finalized = true;
    events.push(
      emitVisibleEvent({
        event_type: "transition_summary",
        content: input.language === "zh" ? "关键信息已收齐，本次访谈完成。" : "Key information is complete. This interview is finished.",
        created_at: now,
      }),
    );
  }

  state.session.last_understanding_feedback = events.find((event) => event.event_type === "understanding_summary")?.payload.content ?? null;
  logAskmoreRuntime("answer_agent_end", {
    session_id: input.sessionId,
    question_id_before: activeQuestionId,
    question_id_after: state.session.current_question_id,
    status: state.session.finalized ? "completed" : input.session.status,
    turn_count_after: nextTurnCount,
    transition_reason: transitionReason,
    pending_commitments: state.session.pending_commitments?.map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status ?? "pending",
      question_id: item.question_id,
      dimension_id: item.dimension_id ?? null,
    })),
    event_types: events.map((event) => event.event_type),
  });

  return {
    state,
    status: state.session.finalized ? "completed" : input.session.status,
    turn_count: nextTurnCount,
    events,
    next_question: nextQuestionPayload,
    messages_already_persisted: false,
    task_module: "AnswerQuestionAgent",
    transition_reason: transitionReason,
    handoff_intent: handoffIntent,
  };
}
