import {
  AskmoreV2FlowQuestion,
  AskmoreV2Intent,
  AskmoreV2Message,
  AskmoreV2PendingCommitment,
  AskmoreV2QuestionNode,
  AskmoreV2Session,
  AskmoreV2SessionState,
  AskmoreV2UnresolvedReason,
} from "@/server/askmore_v2/types";

type GapSeverity = "low" | "medium" | "high";

export interface RuntimeContextSnapshot {
  runtime_contract: {
    version: "v3_phase3";
    max_recent_messages: number;
  };
  active_question: {
    question_id: string | null;
    question: AskmoreV2FlowQuestion | null;
    node: AskmoreV2QuestionNode | null;
  };
  node_coverage: {
    covered_count: number;
    required_count: number;
    remaining_count: number;
  };
  latest_user_turn: {
    message: string;
    turn_count: number;
  };
  recent_memory: {
    user_turns: string[];
    message_snippets: Array<{
      role: "user" | "assistant";
      message: string;
      related: boolean;
    }>;
  };
  structured_knowledge: Record<string, unknown>;
  unresolved_gaps: Array<{
    dimension_id: string;
    label: string;
    reason: AskmoreV2UnresolvedReason;
    severity: GapSeverity;
    actionable: boolean;
  }>;
  pending_commitments: AskmoreV2PendingCommitment[];
  ui_state_hint: {
    pending_intent: AskmoreV2Intent | null;
    latest_visible_summary: string | null;
  };
}

function toKnowledgeSnapshot(state: AskmoreV2SessionState): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state.structured_knowledge).map(([key, value]) => [key, value.value]));
}

function normalizeCommitment(item: AskmoreV2PendingCommitment): AskmoreV2PendingCommitment {
  return {
    ...item,
    status: item.status ?? "pending",
    expires_at: typeof item.expires_at === "undefined" ? null : item.expires_at,
    resolved_at: typeof item.resolved_at === "undefined" ? null : item.resolved_at,
    expired_at: typeof item.expired_at === "undefined" ? null : item.expired_at,
    resolution_note: typeof item.resolution_note === "undefined" ? null : item.resolution_note,
    resolved_turn_index: typeof item.resolved_turn_index === "undefined" ? null : item.resolved_turn_index,
  };
}

export function ensureRuntimeStateDefaults(state: AskmoreV2SessionState): AskmoreV2SessionState {
  if (!state.session.pending_commitments) state.session.pending_commitments = [];
  state.session.pending_commitments = state.session.pending_commitments.map(normalizeCommitment);
  if (typeof state.session.pending_intent === "undefined") state.session.pending_intent = null;
  if (typeof state.session.active_turn_index !== "number") state.session.active_turn_index = 0;
  if (!state.runtime_meta) {
    state.runtime_meta = {
      last_task_module: undefined,
      last_transition_reason: undefined,
      latest_visible_summary: undefined,
      last_help_obstacle_layer: undefined,
      last_help_resolution_goal: undefined,
      last_help_reconnect_target: undefined,
    };
  }
  if (!state.recent_user_turns) state.recent_user_turns = [];
  if (!state.recent_dimension_prompts) state.recent_dimension_prompts = [];
  if (!state.nodes) state.nodes = {};
  if (!state.node_runtime) state.node_runtime = {};
  if (!state.question_progress) state.question_progress = {};
  if (!state.structured_knowledge) state.structured_knowledge = {};
  return state;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((item) => item.length >= 2)
    .slice(0, 40);
}

function isQuestionRelated(params: {
  message: string;
  questionId: string | null;
  questionText: string;
  dimensionLabels: string[];
}): boolean {
  const haystack = params.message.toLowerCase();
  if (!params.questionId) return true;
  if (haystack.includes(params.questionId.toLowerCase())) return true;

  const keywords = new Set<string>([
    ...tokenize(params.questionText),
    ...params.dimensionLabels.flatMap((item) => tokenize(item)),
  ]);
  if (keywords.size === 0) return true;

  let hits = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (haystack.includes(keyword)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

function compactRecentMemory(params: {
  state: AskmoreV2SessionState;
  recentMessages: AskmoreV2Message[];
  questionId: string | null;
  questionText: string;
  dimensionLabels: string[];
  maxItems: number;
}): RuntimeContextSnapshot["recent_memory"] {
  const picked: Array<{ role: "user" | "assistant"; message: string; related: boolean }> = [];
  let pickedConfirmation = false;

  for (let i = params.recentMessages.length - 1; i >= 0; i -= 1) {
    const message = params.recentMessages[i];
    if (message.role !== "user" && message.role !== "assistant") continue;

    const related = isQuestionRelated({
      message: message.message_text,
      questionId: params.questionId,
      questionText: params.questionText,
      dimensionLabels: params.dimensionLabels,
    });

    const isConfirmation = /(确认|micro|confirm|已选择|option)/i.test(message.message_text);
    if (!related && !(isConfirmation && !pickedConfirmation)) continue;

    picked.push({
      role: message.role,
      message: message.message_text,
      related,
    });
    if (isConfirmation) pickedConfirmation = true;

    if (picked.length >= params.maxItems) break;
  }

  const messageSnippets = picked.reverse();
  const userTurnsFromMessages = messageSnippets
    .filter((item) => item.role === "user")
    .map((item) => item.message)
    .slice(-4);

  const fallbackUserTurns = params.state.recent_user_turns.slice(-4);
  return {
    user_turns: userTurnsFromMessages.length > 0 ? userTurnsFromMessages : fallbackUserTurns,
    message_snippets: messageSnippets,
  };
}

function gapSeverity(params: {
  reason: AskmoreV2UnresolvedReason;
  isMust: boolean;
}): GapSeverity {
  if (params.isMust) return "high";
  if (params.reason === "contradictory") return "high";
  if (params.reason === "ambiguous_temporal" || params.reason === "too_short") return "medium";
  return "low";
}

function isGapActionable(params: {
  reason: AskmoreV2UnresolvedReason;
  confidence: number;
}): boolean {
  if (params.reason === "contradictory" || params.reason === "ambiguous_temporal") return true;
  return params.confidence > 0.1;
}

export function buildRuntimeContextSnapshot(params: {
  session: AskmoreV2Session;
  questions: AskmoreV2FlowQuestion[];
  userMessage: string;
  recentMessages?: AskmoreV2Message[];
}): RuntimeContextSnapshot {
  const state = ensureRuntimeStateDefaults(params.session.state_jsonb);
  const questionId = state.session.current_question_id;
  const activeQuestion = questionId
    ? params.questions.find((item) => item.question_id === questionId) ?? null
    : null;
  const activeNode = activeQuestion ? state.nodes[activeQuestion.question_id] ?? null : null;
  const activeNodeRuntime = activeQuestion ? state.node_runtime[activeQuestion.question_id] : null;

  const required = Math.max(1, activeNode?.completion_criteria.length ?? 1);
  let covered = 0;
  if (activeNode && activeNodeRuntime) {
    for (const criterion of activeNode.completion_criteria) {
      const confidence = Number(activeNodeRuntime.dimension_confidence?.[criterion] ?? 0);
      if (confidence >= 0.6) covered += 1;
    }
  }

  const unresolvedGaps = activeNode
    ? activeNode.target_dimensions
        .map((dimension) => {
          const confidence = Number(activeNodeRuntime?.dimension_confidence?.[dimension.id] ?? 0);
          if (confidence >= 0.6) return null;
          const reason = activeNodeRuntime?.dimension_unresolved_reason?.[dimension.id] ?? "semantic_unmapped";
          const isMust = activeNode.completion_criteria.includes(dimension.id);
          return {
            dimension_id: dimension.id,
            label: dimension.label,
            reason,
            severity: gapSeverity({ reason, isMust }),
            actionable: isGapActionable({ reason, confidence }),
          };
        })
        .filter(
          (item): item is RuntimeContextSnapshot["unresolved_gaps"][number] => Boolean(item),
        )
    : [];

  const pendingCommitments = (state.session.pending_commitments ?? []).map(normalizeCommitment);
  const openCurrentQuestionCommitments = pendingCommitments.filter((item) => {
    if ((item.status ?? "pending") !== "pending") return false;
    if (!item.question_id) return true;
    return item.question_id === questionId;
  });

  for (const item of openCurrentQuestionCommitments) {
    if (!item.dimension_id) continue;
    if (unresolvedGaps.some((gap) => gap.dimension_id === item.dimension_id)) continue;
    unresolvedGaps.push({
      dimension_id: item.dimension_id,
      label: item.dimension_id,
      reason: "semantic_unmapped",
      severity: "high",
      actionable: true,
    });
  }

  const questionText = activeNode?.user_facing_entry ?? activeQuestion?.entry_question ?? "";
  const dimensionLabels = activeNode?.target_dimensions.map((item) => item.label) ?? [];
  const recentMemory = compactRecentMemory({
    state,
    recentMessages: params.recentMessages ?? [],
    questionId,
    questionText,
    dimensionLabels,
    maxItems: 8,
  });

  return {
    runtime_contract: {
      version: "v3_phase3",
      max_recent_messages: 8,
    },
    active_question: {
      question_id: questionId,
      question: activeQuestion,
      node: activeNode,
    },
    node_coverage: {
      covered_count: covered,
      required_count: required,
      remaining_count: Math.max(0, required - covered),
    },
    latest_user_turn: {
      message: params.userMessage,
      turn_count: params.session.turn_count,
    },
    recent_memory: recentMemory,
    structured_knowledge: toKnowledgeSnapshot(state),
    unresolved_gaps: unresolvedGaps,
    pending_commitments: pendingCommitments,
    ui_state_hint: {
      pending_intent: state.session.pending_intent ?? null,
      latest_visible_summary: state.runtime_meta?.latest_visible_summary ?? null,
    },
  };
}
