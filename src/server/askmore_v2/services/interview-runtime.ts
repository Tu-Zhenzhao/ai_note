import { randomUUID } from "crypto";
import { getAskmoreV2Repository } from "@/server/askmore_v2/repo";
import { toCanonicalFlowDefinition } from "@/server/askmore_v2/flow-definition";
import { generateExampleAnswers } from "@/server/askmore_v2/services/example-answer-generator";
import { generateInterviewSummary } from "@/server/askmore_v2/services/summary-generator";
import { judgeCompletion } from "@/server/askmore_v2/services/completion-judge";
import { extractTurnFacts } from "@/server/askmore_v2/services/turn-extractor";
import { planDialogueStep } from "@/server/askmore_v2/services/dialogue-planner";
import { composeTurnResponse } from "@/server/askmore_v2/services/response-composer";
import { generateMicroConfirmation } from "@/server/askmore_v2/services/micro-confirm-generator";
import { buildQuestionNode, compileQuestionNodes } from "@/server/askmore_v2/services/node-compiler";
import { understandTurnAndDecide } from "@/server/askmore_v2/services/turn-understanding";
import { tryAutoGenerateInsightOnCompletion } from "@/server/askmore_v2/insight/service";
import {
  buildSemanticDimensionsFromLabels,
  deriveCompletionCriteriaFromDimensions,
  detectDimensionMentionsInTurns,
  isWeakDimensionId,
} from "@/server/askmore_v2/services/dimension-intelligence";
import {
  AskmoreV2DimensionPriority,
  AskmoreV2DimensionAnswerState,
  AskmoreV2DialoguePlannerOutput,
  AskmoreV2FlowQuestion,
  AskmoreV2Language,
  AskmoreV2NodeRuntimeState,
  AskmoreV2MicroConfirmOption,
  AskmoreV2QuestionNode,
  AskmoreV2QuestionProgress,
  AskmoreV2ResponseBlock,
  AskmoreV2Session,
  AskmoreV2SessionState,
  AskmoreV2TurnChoiceInput,
  AskmoreV2TurnAnswerStatus,
  AskmoreV2TurnExtractorOutput,
  AskmoreV2UnresolvedReason,
} from "@/server/askmore_v2/types";

const MAX_QUESTION_COUNT = 50;
const MAX_FOLLOW_UP_PER_QUESTION = 4;
const SUMMARY_ALLOWED_FROM_TURN = 3;
const HARD_COVERED_THRESHOLD = 0.6;
const SOFT_COVERED_THRESHOLD = 0.35;
const RECENT_TURN_WINDOW = 2;
const RECENT_DIMENSION_WINDOW = 2;
const MICRO_CONFIRM_CONFIDENCE = 0.72;
const DIRECT_STRUCTURED_CONFIRM_CONFIDENCE = 0.72;
const SHORT_ANSWER_THRESHOLD = 6;
const PRIORITY_STABLE_STREAK = 2;

function isDebugVerboseEnabled(): boolean {
  return process.env.ASKMORE_V2_DEBUG_VERBOSE === "1";
}

function debugVerbose(event: string, payload: Record<string, unknown>) {
  if (!isDebugVerboseEnabled()) return;
  console.log("[askmore_v2_debug]", event, payload);
}

function isSummaryRequest(message: string): boolean {
  return /(summary|summarize|show summary|总结|小结|概括|汇总)/i.test(message);
}

function isContinueSignal(message: string): boolean {
  return /(continue|go on|继续|接着|继续聊)/i.test(message);
}

function isShowSummarySignal(message: string): boolean {
  return /(show summary|summary|看总结|先看总结|给我总结)/i.test(message);
}

function isRepeatComplaint(message: string): boolean {
  return /(我已经说过|我说过了|都说过了|刚说过|别重复|重复了|already said|i said|you asked this)/i.test(message);
}

function toKnowledgeValues(state: AskmoreV2SessionState): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(state.structured_knowledge).map(([key, value]) => [key, value.value]),
  );
}

function activeQuestionById(questions: AskmoreV2FlowQuestion[], questionId: string | null): AskmoreV2FlowQuestion | null {
  if (!questionId) return null;
  return questions.find((question) => question.question_id === questionId) ?? null;
}

function nextQuestionId(questions: AskmoreV2FlowQuestion[], currentQuestionId: string | null): string | null {
  if (!currentQuestionId) return questions[0]?.question_id ?? null;
  const idx = questions.findIndex((question) => question.question_id === currentQuestionId);
  if (idx < 0) return questions[0]?.question_id ?? null;
  return questions[idx + 1]?.question_id ?? null;
}

function makeNodeRuntimeState(questionId: string): AskmoreV2NodeRuntimeState {
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

function makeQuestionProgress(question: AskmoreV2FlowQuestion): AskmoreV2QuestionProgress {
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

function backfillDimensionStateMaps(params: {
  node: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
}) {
  ensureNodeRuntimeDimensionMaps(params.nodeRuntime);
  for (const dimension of params.node.target_dimensions) {
    const dimensionId = dimension.id;
    const explicit = params.nodeRuntime.dimension_state?.[dimensionId];
    if (explicit) {
      params.nodeRuntime.dimension_answered[dimensionId] = explicit !== "unanswered";
      continue;
    }
    const answered = Boolean(params.nodeRuntime.dimension_answered[dimensionId]);
    const confidence = Number(params.nodeRuntime.dimension_confidence[dimensionId] ?? 0);
    const state: AskmoreV2DimensionAnswerState = !answered
      ? "unanswered"
      : confidence >= HARD_COVERED_THRESHOLD
        ? "structured_confirmed"
        : "answered_unstructured";
    params.nodeRuntime.dimension_state![dimensionId] = state;
    if (typeof params.nodeRuntime.dimension_unresolved_reason?.[dimensionId] === "undefined") {
      params.nodeRuntime.dimension_unresolved_reason![dimensionId] =
        state === "structured_confirmed" || state === "unanswered"
          ? null
          : "semantic_unmapped";
    }
  }
}

function defaultPriorityMapForNode(node: AskmoreV2QuestionNode): Record<string, AskmoreV2DimensionPriority> {
  const mustSet = new Set(node.completion_criteria);
  const map: Record<string, AskmoreV2DimensionPriority> = {};
  for (const dimension of node.target_dimensions) {
    map[dimension.id] = mustSet.has(dimension.id) ? "must" : "optional";
  }
  return map;
}

function ensureDimensionPriorityMapsForNode(params: {
  node: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
}) {
  ensureNodeRuntimeDimensionMaps(params.nodeRuntime);
  const defaults = defaultPriorityMapForNode(params.node);
  for (const dimension of params.node.target_dimensions) {
    const dimensionId = dimension.id;
    if (!params.nodeRuntime.dimension_priority_current![dimensionId]) {
      params.nodeRuntime.dimension_priority_current![dimensionId] = defaults[dimensionId];
    }
    if (!params.nodeRuntime.dimension_priority_candidate![dimensionId]) {
      params.nodeRuntime.dimension_priority_candidate![dimensionId] =
        params.nodeRuntime.dimension_priority_current![dimensionId];
    }
    if (typeof params.nodeRuntime.dimension_priority_streak![dimensionId] !== "number") {
      params.nodeRuntime.dimension_priority_streak![dimensionId] = 0;
    }
    if (typeof params.nodeRuntime.dimension_priority_reason![dimensionId] !== "string") {
      params.nodeRuntime.dimension_priority_reason![dimensionId] = "";
    }
    if (typeof params.nodeRuntime.dimension_priority_downgraded_by_limit![dimensionId] !== "boolean") {
      params.nodeRuntime.dimension_priority_downgraded_by_limit![dimensionId] = false;
    }
  }
}

function getCurrentPriorityMap(params: {
  node: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
}): Record<string, AskmoreV2DimensionPriority> {
  ensureDimensionPriorityMapsForNode(params);
  const out: Record<string, AskmoreV2DimensionPriority> = {};
  for (const dimension of params.node.target_dimensions) {
    out[dimension.id] = params.nodeRuntime.dimension_priority_current?.[dimension.id] ?? "optional";
  }
  return out;
}

function normalizePlannerPriorityMap(params: {
  node: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  plannerResult: AskmoreV2DialoguePlannerOutput;
}): Record<string, AskmoreV2DimensionPriority> {
  ensureDimensionPriorityMapsForNode({
    node: params.node,
    nodeRuntime: params.nodeRuntime,
  });
  const out = getCurrentPriorityMap({
    node: params.node,
    nodeRuntime: params.nodeRuntime,
  });

  for (const [dimensionId, priority] of Object.entries(params.plannerResult.dimension_priority_map ?? {})) {
    if (!params.node.target_dimensions.some((item) => item.id === dimensionId)) continue;
    out[dimensionId] = priority;
  }
  for (const dimensionId of params.plannerResult.must_dimensions ?? []) {
    if (!params.node.target_dimensions.some((item) => item.id === dimensionId)) continue;
    out[dimensionId] = "must";
  }
  for (const dimensionId of params.plannerResult.optional_dimensions ?? []) {
    if (!params.node.target_dimensions.some((item) => item.id === dimensionId)) continue;
    out[dimensionId] = "optional";
  }

  for (const dimension of params.node.target_dimensions) {
    if (!out[dimension.id]) out[dimension.id] = "optional";
  }
  return out;
}

function derivePriorityLists(params: {
  node: AskmoreV2QuestionNode;
  priorityMap: Record<string, AskmoreV2DimensionPriority>;
}): {
  mustDimensions: string[];
  optionalDimensions: string[];
} {
  const mustDimensions = params.node.target_dimensions
    .map((item) => item.id)
    .filter((dimensionId) => params.priorityMap[dimensionId] === "must");
  const optionalDimensions = params.node.target_dimensions
    .map((item) => item.id)
    .filter((dimensionId) => params.priorityMap[dimensionId] !== "must");
  return {
    mustDimensions,
    optionalDimensions,
  };
}

function applyPriorityStabilization(params: {
  node: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  plannerResult: AskmoreV2DialoguePlannerOutput;
}) {
  ensureDimensionPriorityMapsForNode({
    node: params.node,
    nodeRuntime: params.nodeRuntime,
  });
  const normalizedIncomingMap = normalizePlannerPriorityMap({
    node: params.node,
    nodeRuntime: params.nodeRuntime,
    plannerResult: params.plannerResult,
  });

  for (const dimension of params.node.target_dimensions) {
    const dimensionId = dimension.id;
    const current = params.nodeRuntime.dimension_priority_current?.[dimensionId] ?? "optional";
    const previousCandidate = params.nodeRuntime.dimension_priority_candidate?.[dimensionId] ?? current;
    const previousStreak = params.nodeRuntime.dimension_priority_streak?.[dimensionId] ?? 0;
    const incoming = normalizedIncomingMap[dimensionId] ?? current;
    const sameAsCandidate = incoming === previousCandidate;
    const nextCandidate = sameAsCandidate ? previousCandidate : incoming;
    const nextStreak = sameAsCandidate ? previousStreak + 1 : 1;

    params.nodeRuntime.dimension_priority_candidate![dimensionId] = nextCandidate;
    params.nodeRuntime.dimension_priority_streak![dimensionId] = nextStreak;
    params.nodeRuntime.dimension_priority_reason![dimensionId] = params.plannerResult.planner_notes.reason_short;

    if (current !== incoming && nextStreak >= PRIORITY_STABLE_STREAK) {
      params.nodeRuntime.dimension_priority_current![dimensionId] = incoming;
    } else if (!params.nodeRuntime.dimension_priority_current?.[dimensionId]) {
      params.nodeRuntime.dimension_priority_current![dimensionId] = incoming;
    }
  }

  const currentMap = getCurrentPriorityMap({
    node: params.node,
    nodeRuntime: params.nodeRuntime,
  });
  const lists = derivePriorityLists({
    node: params.node,
    priorityMap: currentMap,
  });

  params.plannerResult.dimension_priority_map = currentMap;
  params.plannerResult.must_dimensions = lists.mustDimensions;
  params.plannerResult.optional_dimensions = lists.optionalDimensions;
}

function buildInitialState(params: {
  questions: AskmoreV2FlowQuestion[];
  nodes: Record<string, AskmoreV2QuestionNode>;
}): AskmoreV2SessionState {
  const progress: Record<string, AskmoreV2QuestionProgress> = {};
  const nodeRuntime: Record<string, AskmoreV2NodeRuntimeState> = {};

  for (const question of params.questions) {
    progress[question.question_id] = makeQuestionProgress(question);
    nodeRuntime[question.question_id] = makeNodeRuntimeState(question.question_id);
  }

  return {
    session: {
      current_question_id: params.questions[0]?.question_id ?? null,
      current_sub_question_index: 0,
      summary_generated: false,
      finalized: false,
      pending_end_confirmation: false,
      last_missing_points: [],
      last_understanding_feedback: null,
    },
    recent_user_turns: [],
    recent_dimension_prompts: [],
    nodes: params.nodes,
    node_runtime: nodeRuntime,
    question_progress: progress,
    structured_knowledge: {},
    latest_summary_text: null,
    latest_structured_report: null,
    latest_ai_thinking: null,
    ai_thinking_meta: null,
  };
}

async function ensureNodesInitialized(params: {
  state: AskmoreV2SessionState;
  questions: AskmoreV2FlowQuestion[];
  scenario: string;
  targetOutputType: string;
  language: AskmoreV2Language;
}) {
  if (!params.state.recent_user_turns) {
    params.state.recent_user_turns = [];
  }
  if (!params.state.recent_dimension_prompts) {
    params.state.recent_dimension_prompts = [];
  }

  if (!params.state.nodes || Object.keys(params.state.nodes).length === 0) {
    params.state.nodes = await compileQuestionNodes({
      questions: params.questions,
      scenario: params.scenario,
      targetOutputType: params.targetOutputType,
      language: params.language,
    });
  }

  if (!params.state.node_runtime) {
    params.state.node_runtime = {};
  }

  if (!params.state.question_progress) {
    params.state.question_progress = {};
  }

  for (const question of params.questions) {
    if (!params.state.question_progress[question.question_id]) {
      params.state.question_progress[question.question_id] = makeQuestionProgress(question);
    }

    if (!params.state.node_runtime[question.question_id]) {
      params.state.node_runtime[question.question_id] = makeNodeRuntimeState(question.question_id);
    }
    if (!params.state.node_runtime[question.question_id].dimension_soft_confidence) {
      params.state.node_runtime[question.question_id].dimension_soft_confidence = {};
    }
    if (!params.state.node_runtime[question.question_id].dimension_state) {
      params.state.node_runtime[question.question_id].dimension_state = {};
    }
    if (!params.state.node_runtime[question.question_id].dimension_unresolved_reason) {
      params.state.node_runtime[question.question_id].dimension_unresolved_reason = {};
    }
    if (!params.state.node_runtime[question.question_id].dimension_answered) {
      params.state.node_runtime[question.question_id].dimension_answered = {};
    }
    if (!params.state.node_runtime[question.question_id].dimension_answered_evidence) {
      params.state.node_runtime[question.question_id].dimension_answered_evidence = {};
    }
    if (!params.state.node_runtime[question.question_id].dimension_micro_confirmed) {
      params.state.node_runtime[question.question_id].dimension_micro_confirmed = {};
    }
    if (!("last_micro_confirm_offer" in params.state.node_runtime[question.question_id])) {
      params.state.node_runtime[question.question_id].last_micro_confirm_offer = null;
    }

    if (!params.state.nodes[question.question_id]) {
      params.state.nodes[question.question_id] = buildQuestionNode({
        question,
        language: params.language,
      });
    }

    backfillDimensionStateMaps({
      node: params.state.nodes[question.question_id],
      nodeRuntime: params.state.node_runtime[question.question_id],
    });
    ensureDimensionPriorityMapsForNode({
      node: params.state.nodes[question.question_id],
      nodeRuntime: params.state.node_runtime[question.question_id],
    });
  }

  migrateWeakNodeDimensions({
    state: params.state,
    language: params.language,
  });
}

function remapRecordByDimensionMap<T>(input: Record<string, T>, idMap: Record<string, string>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [oldId, value] of Object.entries(input)) {
    const nextId = idMap[oldId] ?? oldId;
    next[nextId] = value;
  }
  return next;
}

function migrateWeakNodeDimensions(params: {
  state: AskmoreV2SessionState;
  language: AskmoreV2Language;
}) {
  for (const [questionId, node] of Object.entries(params.state.nodes)) {
    const weakDimensions = node.target_dimensions.filter((dimension) => isWeakDimensionId(dimension.id));
    if (weakDimensions.length === 0) continue;

    const nextDimensions = buildSemanticDimensionsFromLabels({
      labels: node.target_dimensions.map((item) => item.label),
      language: params.language,
      maxCount: node.target_dimensions.length,
    });
    const idMap: Record<string, string> = {};
    for (let i = 0; i < node.target_dimensions.length && i < nextDimensions.length; i += 1) {
      idMap[node.target_dimensions[i].id] = nextDimensions[i].id;
    }

    node.target_dimensions = nextDimensions;
    node.completion_criteria = deriveCompletionCriteriaFromDimensions(nextDimensions);

    const nodeRuntime = params.state.node_runtime[questionId];
    if (nodeRuntime) {
      nodeRuntime.captured_dimensions = remapRecordByDimensionMap(nodeRuntime.captured_dimensions, idMap);
      nodeRuntime.dimension_confidence = remapRecordByDimensionMap(nodeRuntime.dimension_confidence, idMap);
      nodeRuntime.dimension_soft_confidence = remapRecordByDimensionMap(
        nodeRuntime.dimension_soft_confidence ?? {},
        idMap,
      );
      nodeRuntime.dimension_state = remapRecordByDimensionMap(
        nodeRuntime.dimension_state ?? {},
        idMap,
      );
      nodeRuntime.dimension_unresolved_reason = remapRecordByDimensionMap(
        nodeRuntime.dimension_unresolved_reason ?? {},
        idMap,
      );
      nodeRuntime.dimension_answered = remapRecordByDimensionMap(
        nodeRuntime.dimension_answered ?? {},
        idMap,
      );
      nodeRuntime.dimension_answered_evidence = remapRecordByDimensionMap(
        nodeRuntime.dimension_answered_evidence ?? {},
        idMap,
      );
      nodeRuntime.dimension_micro_confirmed = remapRecordByDimensionMap(
        nodeRuntime.dimension_micro_confirmed ?? {},
        idMap,
      );
      nodeRuntime.dimension_priority_current = remapRecordByDimensionMap(
        nodeRuntime.dimension_priority_current ?? {},
        idMap,
      );
      nodeRuntime.dimension_priority_candidate = remapRecordByDimensionMap(
        nodeRuntime.dimension_priority_candidate ?? {},
        idMap,
      );
      nodeRuntime.dimension_priority_streak = remapRecordByDimensionMap(
        nodeRuntime.dimension_priority_streak ?? {},
        idMap,
      );
      nodeRuntime.dimension_priority_reason = remapRecordByDimensionMap(
        nodeRuntime.dimension_priority_reason ?? {},
        idMap,
      );
      nodeRuntime.dimension_priority_downgraded_by_limit = remapRecordByDimensionMap(
        nodeRuntime.dimension_priority_downgraded_by_limit ?? {},
        idMap,
      );
      if (
        nodeRuntime.last_micro_confirm_offer &&
        idMap[nodeRuntime.last_micro_confirm_offer.dimension_id]
      ) {
        nodeRuntime.last_micro_confirm_offer.dimension_id = idMap[nodeRuntime.last_micro_confirm_offer.dimension_id];
      }
      ensureDimensionPriorityMapsForNode({
        node,
        nodeRuntime,
      });
    }

    params.state.recent_dimension_prompts = params.state.recent_dimension_prompts.map((promptKey) => {
      const [promptQuestionId, promptDimensionId] = promptKey.split("::");
      if (promptQuestionId !== questionId) return promptKey;
      const mapped = idMap[promptDimensionId];
      return mapped ? `${promptQuestionId}::${mapped}` : promptKey;
    });
  }
}

function mapAnswerStatusFromQuality(answerQuality: AskmoreV2TurnExtractorOutput["answer_quality"]): AskmoreV2TurnAnswerStatus {
  if (answerQuality === "off_topic") return "off_topic";
  if (answerQuality === "clear") return "complete";
  return "partial";
}

function coverageFromAnswerQuality(answerQuality: AskmoreV2TurnExtractorOutput["answer_quality"]): number {
  if (answerQuality === "clear") return 1;
  if (answerQuality === "usable") return 0.65;
  if (answerQuality === "vague") return 0.35;
  return 0.2;
}

function mergeSummaryPatch(params: {
  now: string;
  state: AskmoreV2SessionState;
  patch: Record<string, unknown>;
  confidence: number;
  confirmed: boolean;
}) {
  for (const [key, value] of Object.entries(params.patch)) {
    if (!key) continue;
    if (value == null || (typeof value === "string" && value.trim().length === 0)) continue;
    const existing = params.state.structured_knowledge[key];
    if (existing?.confirmed) continue;
    if (existing && existing.value != null && String(existing.value).trim().length > 0 && params.confidence < existing.confidence) {
      continue;
    }

    params.state.structured_knowledge[key] = {
      value,
      confidence: Math.max(existing?.confidence ?? 0, params.confidence),
      confirmed: existing?.confirmed ?? params.confirmed,
      updated_at: params.now,
    };
  }
}

function buildSummaryPatchFromExtractor(params: {
  questionId: string;
  extractorResult: AskmoreV2TurnExtractorOutput;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [dimensionId, fact] of Object.entries(params.extractorResult.facts_extracted)) {
    patch[`${params.questionId}__${dimensionId}`] = fact.value;
  }
  if (params.extractorResult.candidate_hypothesis.trim().length > 0) {
    patch[`${params.questionId}__hypothesis`] = params.extractorResult.candidate_hypothesis;
  }
  return patch;
}

function dimensionLabel(currentNode: AskmoreV2QuestionNode, dimensionId: string): string {
  return currentNode.target_dimensions.find((item) => item.id === dimensionId)?.label ?? dimensionId;
}

function buildClarifyQuestion(params: {
  language: AskmoreV2Language;
  currentNode: AskmoreV2QuestionNode;
  dimensionId: string | null;
}): string | null {
  if (!params.dimensionId) return null;
  const label = dimensionLabel(params.currentNode, params.dimensionId);

  return params.language === "zh"
    ? `我们再补一个点就更完整了：关于「${label}」，你观察到的情况更接近哪一种？`
    : `One more point and this topic will be much clearer: for "${label}", what did you observe most directly?`;
}

function buildNodeSummary(params: {
  language: AskmoreV2Language;
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
}): string | null {
  const covered = params.currentNode.target_dimensions
    .filter((dimension) => (params.nodeRuntime.dimension_confidence[dimension.id] ?? 0) >= 0.6)
    .map((dimension) => {
      const value = params.nodeRuntime.captured_dimensions[dimension.id];
      return value ? `${dimension.label}：${value}` : null;
    })
    .filter((value): value is string => Boolean(value));

  if (covered.length === 0) return null;

  if (params.language === "zh") {
    return [
      "好，这一部分我先做个小结：",
      ...covered.slice(0, 3).map((line) => `- ${line}`),
      "这部分信息已经够我们继续往下走了。",
    ].join("\n");
  }

  return [
    "Quick wrap-up for this topic:",
    ...covered.slice(0, 3).map((line) => `- ${line}`),
    "This is enough for us to move forward.",
  ].join("\n");
}

function blockContent(blocks: AskmoreV2ResponseBlock[], type: AskmoreV2ResponseBlock["type"]): string | null {
  return blocks.find((block) => block.type === type)?.content ?? null;
}

function blockItems(blocks: AskmoreV2ResponseBlock[], type: AskmoreV2ResponseBlock["type"]): string[] {
  const entry = blocks.find((block) => block.type === type);
  return Array.isArray(entry?.items) ? entry.items : [];
}

function composeAssistantMessage(params: {
  language: AskmoreV2Language;
  blocks: AskmoreV2ResponseBlock[];
}): string {
  const lines: string[] = [];

  for (const block of params.blocks) {
    if (block.type === "example_answers") {
      if (!block.items || block.items.length === 0) continue;
      lines.push(params.language === "zh" ? "你可以这样回答：" : "You can answer like this:");
      for (const item of block.items.slice(0, 4)) {
        lines.push(`- ${item}`);
      }
      continue;
    }
    if (block.type === "micro_confirm_options") {
      if (!block.options || block.options.length === 0) continue;
      lines.push(
        params.language === "zh"
          ? "你可以直接点一个更接近的选项："
          : "You can pick one quick option:",
      );
      for (const item of block.options.slice(0, 4)) {
        lines.push(`- ${item.option_id}. ${item.label}`);
      }
      continue;
    }

    const content = block.content?.trim();
    if (!content) continue;
    lines.push(content);
  }

  return lines.join("\n\n").trim();
}

async function persistAssistantMessage(params: {
  sessionId: string;
  content: string;
}) {
  const repo = getAskmoreV2Repository();
  await repo.addMessage({
    id: randomUUID(),
    session_id: params.sessionId,
    role: "assistant",
    message_text: params.content,
    created_at: new Date().toISOString(),
  });
}

function mergeExtractorFactsToNodeRuntime(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  extractorResult: AskmoreV2TurnExtractorOutput;
  recentUserTurns: string[];
  replayMentions: Record<string, { mentioned: boolean; strong: boolean }>;
}) {
  const recentJoined = params.recentUserTurns.join(" ").toLowerCase();
  for (const [dimensionId, fact] of Object.entries(params.extractorResult.facts_extracted)) {
    params.nodeRuntime.captured_dimensions[dimensionId] = fact.value;
    params.nodeRuntime.dimension_confidence[dimensionId] = Math.max(
      params.nodeRuntime.dimension_confidence[dimensionId] ?? 0,
      fact.confidence,
    );

    const evidence = fact.evidence.trim().toLowerCase();
    const relevantByEvidence = evidence.length > 0 && (recentJoined.includes(evidence) || evidence.includes(recentJoined.slice(0, 24)));
    const relevantByReplay = params.replayMentions[dimensionId]?.mentioned ?? false;
    if (fact.confidence >= SOFT_COVERED_THRESHOLD && (relevantByEvidence || relevantByReplay)) {
      params.nodeRuntime.dimension_soft_confidence[dimensionId] = Math.max(
        params.nodeRuntime.dimension_soft_confidence[dimensionId] ?? 0,
        fact.confidence,
      );
    }

    if (fact.confidence >= HARD_COVERED_THRESHOLD) {
      setDimensionState({
        nodeRuntime: params.nodeRuntime,
        dimensionId,
        state: "structured_confirmed",
        unresolvedReason: null,
      });
    }
  }

  for (const dimension of params.currentNode.target_dimensions) {
    const mention = params.replayMentions[dimension.id];
    if (!mention?.mentioned) continue;
    const replayConfidence = mention.strong ? 0.66 : 0.4;
    params.nodeRuntime.dimension_soft_confidence[dimension.id] = Math.max(
      params.nodeRuntime.dimension_soft_confidence[dimension.id] ?? 0,
      replayConfidence,
    );
  }

  params.nodeRuntime.candidate_hypothesis = params.extractorResult.candidate_hypothesis;
  params.nodeRuntime.contradiction_detected =
    params.nodeRuntime.contradiction_detected || params.extractorResult.contradiction_detected;
}

function ensureNodeRuntimeDimensionMaps(nodeRuntime: AskmoreV2NodeRuntimeState) {
  if (!nodeRuntime.dimension_answered) nodeRuntime.dimension_answered = {};
  if (!nodeRuntime.dimension_answered_evidence) nodeRuntime.dimension_answered_evidence = {};
  if (!nodeRuntime.dimension_micro_confirmed) nodeRuntime.dimension_micro_confirmed = {};
  if (!nodeRuntime.dimension_soft_confidence) nodeRuntime.dimension_soft_confidence = {};
  if (!nodeRuntime.dimension_state) nodeRuntime.dimension_state = {};
  if (!nodeRuntime.dimension_unresolved_reason) nodeRuntime.dimension_unresolved_reason = {};
  if (!nodeRuntime.dimension_priority_current) nodeRuntime.dimension_priority_current = {};
  if (!nodeRuntime.dimension_priority_candidate) nodeRuntime.dimension_priority_candidate = {};
  if (!nodeRuntime.dimension_priority_streak) nodeRuntime.dimension_priority_streak = {};
  if (!nodeRuntime.dimension_priority_reason) nodeRuntime.dimension_priority_reason = {};
  if (!nodeRuntime.dimension_priority_downgraded_by_limit) nodeRuntime.dimension_priority_downgraded_by_limit = {};
  if (typeof nodeRuntime.last_micro_confirm_offer === "undefined") {
    nodeRuntime.last_micro_confirm_offer = null;
  }
}

function isTemporalDimension(params: {
  currentNode: AskmoreV2QuestionNode;
  dimensionId: string;
}): boolean {
  const label = params.currentNode.target_dimensions.find((item) => item.id === params.dimensionId)?.label ?? "";
  const source = `${params.dimensionId} ${label}`;
  return /(onset|timing|start|recent|duration|时间|时机|开始|起因|发生|最近|一直以来|常年|突然)/i.test(source);
}

function hasTemporalPhrase(text: string): boolean {
  return /(最近|刚|才开始|开始|突然|一直|常年|搬家后|这几天|这几周|这几个月|近来|近期|since|recent|started|sudden|for)/i.test(text);
}

function hasSpecificTemporalAnchor(text: string): boolean {
  return /(\d+\s*(天|周|个月|月|年|days?|weeks?|months?|years?))|(最近几天|最近几周|最近几个月|最近一两周|这几天|这几周|这几个月|一直以来|常年|搬家后|上周|上个月|上半年|近一周|近一个月|最近才开始|刚开始|近期突发|突然出现|突然开始)/i.test(
    text,
  );
}

function hasUncertaintySignal(text: string): boolean {
  return /(不太确定|不确定|不知道|不清楚|说不好|没法判断|not sure|don't know|dont know|unsure|idk)/i.test(text);
}

function inferUnresolvedReason(params: {
  currentNode: AskmoreV2QuestionNode;
  dimensionId: string;
  userMessage: string;
  contradictionDetected: boolean;
  fromReplay: boolean;
  fromExtractor: boolean;
}): AskmoreV2UnresolvedReason {
  const text = params.userMessage.trim();
  if (params.contradictionDetected) return "contradictory";
  if (text.length <= SHORT_ANSWER_THRESHOLD) return "too_short";
  if (isTemporalDimension({ currentNode: params.currentNode, dimensionId: params.dimensionId }) && hasTemporalPhrase(text) && !hasSpecificTemporalAnchor(text)) {
    return "ambiguous_temporal";
  }
  if (params.fromReplay && !params.fromExtractor) return "semantic_unmapped";
  return "semantic_unmapped";
}

function isHighRiskUnresolvedReason(
  reason: AskmoreV2UnresolvedReason | null | undefined,
): boolean {
  return reason === "contradictory" || reason === "too_short" || reason === "ambiguous_temporal";
}

function classifyTemporalDirectValue(text: string): string | null {
  if (/(搬家后|环境变化后|来人后|应激后)/i.test(text)) return "post_change_onset";
  if (/(一直以来|一直都|长期|常年|好几年)/i.test(text)) return "longstanding";
  if (/(最近几天|最近这几天|这几天|近一周)/i.test(text)) return "started_recent_days";
  if (/(最近几周|这几周|一两周|近一个月)/i.test(text)) return "started_recent_weeks";
  if (/(最近几个月|这几个月)/i.test(text)) return "started_recent_months";
  if (/(近期突发|突发|最近才突然出现|突然出现|突然开始|刚开始|最近才开始|最近才出现)/i.test(text)) {
    return "recent_onset";
  }
  return null;
}

function applyDirectStructuredConfirmation(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  userMessage: string;
  replayMentions: Record<string, { mentioned: boolean; strong: boolean }>;
  extractorResult: AskmoreV2TurnExtractorOutput;
}): string[] {
  const promoted: string[] = [];
  const text = params.userMessage.trim();
  if (text.length <= SHORT_ANSWER_THRESHOLD) return promoted;

  for (const dimension of params.currentNode.target_dimensions) {
    const dimensionId = dimension.id;
    if (!isTemporalDimension({ currentNode: params.currentNode, dimensionId })) continue;
    const stateBefore = getDimensionState({
      nodeRuntime: params.nodeRuntime,
      dimensionId,
    });
    if (stateBefore === "structured_confirmed" || stateBefore === "unanswered") continue;
    const mention = params.replayMentions[dimensionId];
    if (!mention?.mentioned) continue;
    const normalizedValue = classifyTemporalDirectValue(text);
    if (!normalizedValue) continue;

    params.nodeRuntime.captured_dimensions[dimensionId] = normalizedValue;
    params.nodeRuntime.dimension_confidence[dimensionId] = Math.max(
      params.nodeRuntime.dimension_confidence[dimensionId] ?? 0,
      DIRECT_STRUCTURED_CONFIRM_CONFIDENCE,
    );
    params.nodeRuntime.dimension_soft_confidence[dimensionId] = Math.max(
      params.nodeRuntime.dimension_soft_confidence[dimensionId] ?? 0,
      DIRECT_STRUCTURED_CONFIRM_CONFIDENCE,
    );
    setDimensionState({
      nodeRuntime: params.nodeRuntime,
      dimensionId,
      state: "structured_confirmed",
      unresolvedReason: null,
    });
    if (!params.nodeRuntime.dimension_answered_evidence[dimensionId]) {
      params.nodeRuntime.dimension_answered_evidence[dimensionId] = text.slice(0, 120);
    }
    params.extractorResult.facts_extracted[dimensionId] = {
      value: normalizedValue,
      evidence: text.slice(0, 120),
      confidence: DIRECT_STRUCTURED_CONFIRM_CONFIDENCE,
    };
    params.extractorResult.updated_dimensions = [
      ...new Set([...params.extractorResult.updated_dimensions, dimensionId]),
    ];
    promoted.push(dimensionId);
  }

  return promoted;
}

function getDimensionState(params: {
  nodeRuntime: AskmoreV2NodeRuntimeState;
  dimensionId: string;
}): AskmoreV2DimensionAnswerState {
  ensureNodeRuntimeDimensionMaps(params.nodeRuntime);
  const explicit = params.nodeRuntime.dimension_state?.[params.dimensionId];
  if (explicit) return explicit;

  const answered = Boolean(params.nodeRuntime.dimension_answered?.[params.dimensionId]);
  const confidence = Number(params.nodeRuntime.dimension_confidence?.[params.dimensionId] ?? 0);
  if (!answered) return "unanswered";
  if (confidence >= HARD_COVERED_THRESHOLD) return "structured_confirmed";
  return "answered_unstructured";
}

function setDimensionState(params: {
  nodeRuntime: AskmoreV2NodeRuntimeState;
  dimensionId: string;
  state: AskmoreV2DimensionAnswerState;
  unresolvedReason?: AskmoreV2UnresolvedReason | null;
}) {
  ensureNodeRuntimeDimensionMaps(params.nodeRuntime);
  params.nodeRuntime.dimension_state![params.dimensionId] = params.state;
  params.nodeRuntime.dimension_answered[params.dimensionId] = params.state !== "unanswered";
  if (typeof params.unresolvedReason !== "undefined") {
    params.nodeRuntime.dimension_unresolved_reason![params.dimensionId] = params.unresolvedReason;
  } else if (params.state === "structured_confirmed") {
    params.nodeRuntime.dimension_unresolved_reason![params.dimensionId] = null;
  }
}

function markAnsweredDimensions(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  extractorResult: AskmoreV2TurnExtractorOutput;
  replayMentions: Record<string, { mentioned: boolean; strong: boolean }>;
  userMessage: string;
}): string[] {
  ensureNodeRuntimeDimensionMaps(params.nodeRuntime);
  const changes: string[] = [];
  const snippet = params.userMessage.trim().slice(0, 120);

  for (const [dimensionId, fact] of Object.entries(params.extractorResult.facts_extracted)) {
    const previous = getDimensionState({
      nodeRuntime: params.nodeRuntime,
      dimensionId,
    });
    if (previous === "unanswered") {
      changes.push(dimensionId);
    }
    const nextState: AskmoreV2DimensionAnswerState =
      fact.confidence >= HARD_COVERED_THRESHOLD ? "structured_confirmed" : "answered_unstructured";
    setDimensionState({
      nodeRuntime: params.nodeRuntime,
      dimensionId,
      state: nextState,
      unresolvedReason:
        nextState === "structured_confirmed"
          ? null
          : inferUnresolvedReason({
              currentNode: params.currentNode,
              dimensionId,
              userMessage: params.userMessage,
              contradictionDetected: params.extractorResult.contradiction_detected,
              fromReplay: false,
              fromExtractor: true,
            }),
    });
    if (!params.nodeRuntime.dimension_answered_evidence[dimensionId]) {
      params.nodeRuntime.dimension_answered_evidence[dimensionId] = fact.evidence || snippet || fact.value;
    }
  }

  for (const dimension of params.currentNode.target_dimensions) {
    const dimensionId = dimension.id;
    if (!params.replayMentions[dimensionId]?.mentioned) continue;
    const previous = getDimensionState({
      nodeRuntime: params.nodeRuntime,
      dimensionId,
    });
    if (previous === "unanswered") {
      changes.push(dimensionId);
    }
    if (previous !== "structured_confirmed") {
      setDimensionState({
        nodeRuntime: params.nodeRuntime,
        dimensionId,
        state: "answered_unstructured",
        unresolvedReason: inferUnresolvedReason({
          currentNode: params.currentNode,
          dimensionId,
          userMessage: params.userMessage,
          contradictionDetected: params.extractorResult.contradiction_detected,
          fromReplay: true,
          fromExtractor: Boolean(params.extractorResult.facts_extracted[dimensionId]),
        }),
      });
    }
    if (!params.nodeRuntime.dimension_answered_evidence[dimensionId] && snippet) {
      params.nodeRuntime.dimension_answered_evidence[dimensionId] = snippet;
    }
  }

  return [...new Set(changes)];
}

function computeUnansweredDimensions(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
}): string[] {
  ensureNodeRuntimeDimensionMaps(params.nodeRuntime);
  return params.currentNode.target_dimensions
    .map((dimension) => dimension.id)
    .filter((dimensionId) => getDimensionState({
      nodeRuntime: params.nodeRuntime,
      dimensionId,
    }) === "unanswered");
}

function computeUnansweredMustDimensions(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
}): string[] {
  ensureDimensionPriorityMapsForNode({
    node: params.currentNode,
    nodeRuntime: params.nodeRuntime,
  });
  return params.currentNode.target_dimensions
    .map((dimension) => dimension.id)
    .filter((dimensionId) => {
      const priority = params.nodeRuntime.dimension_priority_current?.[dimensionId] ?? "optional";
      if (priority !== "must") return false;
      return getDimensionState({
        nodeRuntime: params.nodeRuntime,
        dimensionId,
      }) === "unanswered";
    });
}

function downgradeMustDimensionsByLimit(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  dimensionIds: string[];
  reason: string;
}) {
  ensureDimensionPriorityMapsForNode({
    node: params.currentNode,
    nodeRuntime: params.nodeRuntime,
  });
  for (const dimensionId of params.dimensionIds) {
    if (!params.currentNode.target_dimensions.some((item) => item.id === dimensionId)) continue;
    params.nodeRuntime.dimension_priority_current![dimensionId] = "optional";
    params.nodeRuntime.dimension_priority_candidate![dimensionId] = "optional";
    params.nodeRuntime.dimension_priority_streak![dimensionId] = PRIORITY_STABLE_STREAK;
    params.nodeRuntime.dimension_priority_reason![dimensionId] = params.reason;
    params.nodeRuntime.dimension_priority_downgraded_by_limit![dimensionId] = true;
  }
}

function promoteProvisionalMention(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  dimensionId: string;
  userMessage: string;
}): boolean {
  const exists = params.currentNode.target_dimensions.some((dimension) => dimension.id === params.dimensionId);
  if (!exists) return false;
  const before = getDimensionState({
    nodeRuntime: params.nodeRuntime,
    dimensionId: params.dimensionId,
  });
  if (before !== "unanswered") return false;

  const evidence = params.userMessage.trim().slice(0, 120);
  setDimensionState({
    nodeRuntime: params.nodeRuntime,
    dimensionId: params.dimensionId,
    state: "answered_unstructured",
    unresolvedReason: inferUnresolvedReason({
      currentNode: params.currentNode,
      dimensionId: params.dimensionId,
      userMessage: params.userMessage,
      contradictionDetected: false,
      fromReplay: true,
      fromExtractor: false,
    }),
  });
  if (evidence) {
    params.nodeRuntime.dimension_answered_evidence[params.dimensionId] = evidence;
  }
  return true;
}

function dimensionConfidence(nodeRuntime: AskmoreV2NodeRuntimeState, dimensionId: string): number {
  return Number(nodeRuntime.dimension_confidence[dimensionId] ?? 0);
}

function applyChoiceToNodeRuntime(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  choice: AskmoreV2TurnChoiceInput;
  userMessage: string;
}): { applied: boolean; resolvedValue: string | null; reason?: string } {
  ensureNodeRuntimeDimensionMaps(params.nodeRuntime);
  const target = params.currentNode.target_dimensions.find((dimension) => dimension.id === params.choice.dimension_id);
  if (!target) {
    return { applied: false, resolvedValue: null, reason: "dimension_not_found" };
  }

  const offer = params.nodeRuntime.last_micro_confirm_offer;
  const offered = offer?.dimension_id === params.choice.dimension_id
    ? offer.options.find((item) => item.option_id === params.choice.option_id)
    : null;
  const resolvedValue = offered?.normalized_value ?? params.choice.option_label.trim();
  const evidence = params.userMessage.trim() || params.choice.option_label.trim();

  params.nodeRuntime.captured_dimensions[target.id] = resolvedValue;
  params.nodeRuntime.dimension_confidence[target.id] = Math.max(
    params.nodeRuntime.dimension_confidence[target.id] ?? 0,
    MICRO_CONFIRM_CONFIDENCE,
  );
  params.nodeRuntime.dimension_soft_confidence[target.id] = Math.max(
    params.nodeRuntime.dimension_soft_confidence[target.id] ?? 0,
    MICRO_CONFIRM_CONFIDENCE,
  );
  setDimensionState({
    nodeRuntime: params.nodeRuntime,
    dimensionId: target.id,
    state: "structured_confirmed",
    unresolvedReason: null,
  });
  params.nodeRuntime.dimension_answered_evidence[target.id] = evidence;
  params.nodeRuntime.dimension_micro_confirmed[target.id] = true;

  debugVerbose("choice_applied", {
    dimension_id: target.id,
    option_id: params.choice.option_id,
    option_label: params.choice.option_label,
    normalized_value: resolvedValue,
  });

  return { applied: true, resolvedValue };
}

function computeCoverageCounts(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  extractorResult: AskmoreV2TurnExtractorOutput;
}) {
  const hardConfidence: Record<string, number> = {
    ...params.nodeRuntime.dimension_confidence,
  };
  const softConfidence: Record<string, number> = {
    ...params.nodeRuntime.dimension_soft_confidence,
  };
  for (const [dimensionId, fact] of Object.entries(params.extractorResult.facts_extracted)) {
    hardConfidence[dimensionId] = Math.max(hardConfidence[dimensionId] ?? 0, fact.confidence);
    if (fact.confidence >= SOFT_COVERED_THRESHOLD) {
      softConfidence[dimensionId] = Math.max(softConfidence[dimensionId] ?? 0, fact.confidence);
    }
  }

  let hardCovered = 0;
  let softCovered = 0;
  for (const criterion of params.currentNode.completion_criteria) {
    if ((hardConfidence[criterion] ?? 0) >= HARD_COVERED_THRESHOLD) {
      hardCovered += 1;
      softCovered += 1;
      continue;
    }
    if ((softConfidence[criterion] ?? 0) >= SOFT_COVERED_THRESHOLD) {
      softCovered += 1;
    }
  }

  return {
    hardCovered,
    softCovered,
    required: Math.max(1, params.currentNode.completion_criteria.length),
    hardConfidence,
    softConfidence,
  };
}

function computeMissingDimensionsFromHard(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  extractorResult: AskmoreV2TurnExtractorOutput;
}): string[] {
  const hardConfidence = {
    ...params.nodeRuntime.dimension_confidence,
  };
  for (const [dimensionId, fact] of Object.entries(params.extractorResult.facts_extracted)) {
    hardConfidence[dimensionId] = Math.max(hardConfidence[dimensionId] ?? 0, fact.confidence);
  }
  return params.currentNode.target_dimensions
    .map((dimension) => dimension.id)
    .filter((dimensionId) => (hardConfidence[dimensionId] ?? 0) < HARD_COVERED_THRESHOLD);
}

function recentPromptKey(questionId: string, dimensionId: string): string {
  return `${questionId}::${dimensionId}`;
}

function wasDimensionRecentlyPrompted(params: {
  state: AskmoreV2SessionState;
  questionId: string;
  dimensionId: string;
}): boolean {
  const key = recentPromptKey(params.questionId, params.dimensionId);
  return params.state.recent_dimension_prompts.slice(-RECENT_DIMENSION_WINDOW).includes(key);
}

function rememberPromptedDimension(params: {
  state: AskmoreV2SessionState;
  questionId: string;
  dimensionId: string;
}) {
  const key = recentPromptKey(params.questionId, params.dimensionId);
  const next = [...params.state.recent_dimension_prompts, key];
  params.state.recent_dimension_prompts = next.slice(-RECENT_DIMENSION_WINDOW);
}

function findMicroConfirmCandidate(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  choice: AskmoreV2TurnChoiceInput | undefined;
  preferredDimensionIds: Array<string | null | undefined>;
}) {
  if (params.choice) return null;

  const dimensionById = new Map(
    params.currentNode.target_dimensions.map((dimension) => [dimension.id, dimension]),
  );
  const isEligible = (dimensionId: string) => {
    const dimension = dimensionById.get(dimensionId);
    if (!dimension) return false;
    const stateForDimension = getDimensionState({
      nodeRuntime: params.nodeRuntime,
      dimensionId,
    });
    const priority = params.nodeRuntime.dimension_priority_current?.[dimensionId] ?? "optional";
    const unresolvedReason = params.nodeRuntime.dimension_unresolved_reason?.[dimensionId] ?? null;
    return (
      priority === "must" &&
      isHighRiskUnresolvedReason(unresolvedReason) &&
      stateForDimension !== "unanswered" &&
      stateForDimension !== "structured_confirmed" &&
      !params.nodeRuntime.dimension_micro_confirmed[dimensionId]
    );
  };

  for (const candidateId of params.preferredDimensionIds) {
    if (!candidateId) continue;
    if (isEligible(candidateId)) {
      return {
        dimension: dimensionById.get(candidateId)!,
        source: "preferred",
      };
    }
  }

  for (const dimension of params.currentNode.target_dimensions) {
    if (isEligible(dimension.id)) {
      return {
        dimension,
        source: "fallback_first_eligible",
      };
    }
  }

  return null;
}

function rememberUserTurn(params: {
  state: AskmoreV2SessionState;
  userMessage: string;
}) {
  params.state.recent_user_turns = [...params.state.recent_user_turns, params.userMessage].slice(-RECENT_TURN_WINDOW);
}

function backfillNodeFromReplay(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  replayMentions: Record<string, { mentioned: boolean; strong: boolean }>;
  latestUserMessage: string;
}): AskmoreV2TurnExtractorOutput["facts_extracted"] {
  const patch: AskmoreV2TurnExtractorOutput["facts_extracted"] = {};
  const snippet = params.latestUserMessage.trim().slice(0, 120);
  if (!snippet) return patch;

  for (const dimension of params.currentNode.target_dimensions) {
    if (params.nodeRuntime.captured_dimensions[dimension.id]) continue;
    const mention = params.replayMentions[dimension.id];
    if (!mention?.mentioned) continue;
    const confidence = mention.strong ? 0.66 : 0.4;
    patch[dimension.id] = {
      value: snippet,
      evidence: snippet,
      confidence,
    };
  }

  return patch;
}

function plannerActionToLegacyNextAction(params: {
  plannerAction: AskmoreV2DialoguePlannerOutput["planner_action"];
  shouldClarify: boolean;
  shouldAskSummaryChoice: boolean;
  status: AskmoreV2Session["status"];
}): "advance_to_next_question" | "ask_clarification" | "show_summary" | "end_interview" {
  if (params.status === "completed") return "end_interview";
  if (params.shouldAskSummaryChoice || params.plannerAction === "offer_early_summary") return "show_summary";
  if (params.shouldClarify) return "ask_clarification";
  return "advance_to_next_question";
}

function allMainQuestionsCompleted(params: {
  questions: AskmoreV2FlowQuestion[];
  state: AskmoreV2SessionState;
}): boolean {
  return params.questions.every((question) => {
    const progress = params.state.question_progress[question.question_id];
    return progress?.status === "completed";
  });
}

function allCurrentMustDimensionsAnswered(params: {
  questions: AskmoreV2FlowQuestion[];
  state: AskmoreV2SessionState;
}): boolean {
  return params.questions.every((question) => {
    const node = params.state.nodes[question.question_id];
    const nodeRuntime = params.state.node_runtime[question.question_id];
    if (!node || !nodeRuntime) return false;
    for (const dimension of node.target_dimensions) {
      const priority = nodeRuntime.dimension_priority_current?.[dimension.id] ?? "optional";
      if (priority !== "must") continue;
      const answered = getDimensionState({
        nodeRuntime,
        dimensionId: dimension.id,
      }) !== "unanswered";
      if (!answered) return false;
    }
    return true;
  });
}

function legacyIntelligenceFromTurnUnderstanding(params: {
  language: AskmoreV2Language;
  currentNode: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  userMessage: string;
  turnCount: number;
  allowFollowUp: boolean;
  structuredKnowledge: Record<string, unknown>;
}): Promise<{
  extractorResult: AskmoreV2TurnExtractorOutput;
  plannerResult: AskmoreV2DialoguePlannerOutput;
  composerBlocks: AskmoreV2ResponseBlock[];
}> {
  return understandTurnAndDecide({
    language: params.language,
    activeQuestion: params.currentNode.user_facing_entry,
    activeSubQuestion: params.currentNode.user_facing_entry,
    userMessage: params.userMessage,
    turnCount: params.turnCount,
    allowFollowUp: params.allowFollowUp,
    structuredKnowledge: params.structuredKnowledge,
  }).then((legacy) => {
    const firstDimension = params.currentNode.target_dimensions[0];
    const facts = firstDimension && legacy.summary_patch && Object.keys(legacy.summary_patch).length > 0
      ? {
          [firstDimension.id]: {
            value: String(legacy.summary_patch[Object.keys(legacy.summary_patch)[0]] ?? params.userMessage),
            evidence: params.userMessage.slice(0, 120),
            confidence: legacy.confidence === "high" ? 0.88 : legacy.confidence === "medium" ? 0.72 : 0.58,
          },
        }
      : {};

    const extractorResult: AskmoreV2TurnExtractorOutput = {
      facts_extracted: facts,
      updated_dimensions: Object.keys(facts),
      missing_dimensions: params.currentNode.target_dimensions
        .map((dimension) => dimension.id)
        .filter((dimensionId) => !(dimensionId in facts)),
      answer_quality: legacy.answer_status === "complete" ? "clear" : legacy.answer_status === "off_topic" ? "off_topic" : "usable",
      user_effort_signal: "normal",
      contradiction_detected: false,
      candidate_hypothesis: legacy.readiness.reason,
      confidence_overall: legacy.readiness.readiness_score,
    };

    const plannerAction: AskmoreV2DialoguePlannerOutput["planner_action"] =
      legacy.suggested_next_action === "ask_clarification"
        ? "micro_confirm_then_clarify"
        : legacy.suggested_next_action === "show_summary"
          ? "offer_early_summary"
          : legacy.suggested_next_action === "end_interview"
            ? "end_interview"
            : "micro_confirm_then_advance";

    const plannerResult: AskmoreV2DialoguePlannerOutput = {
      node_status: legacy.answer_status === "complete" ? "complete" : "partial",
      planner_action: plannerAction,
      chosen_dimension_to_ask: params.currentNode.target_dimensions[0]?.id ?? null,
      should_show_micro_confirmation: true,
      should_use_hypothesis_style: false,
      should_show_node_summary: false,
      should_offer_early_summary: plannerAction === "offer_early_summary",
      progress_signal: {
        covered_count: legacy.answer_status === "complete" ? 1 : 0,
        required_count: Math.max(1, params.currentNode.completion_criteria.length),
        remaining_count: legacy.answer_status === "complete" ? 0 : 1,
      },
      readiness: {
        node_readiness: legacy.answer_status === "complete" ? 0.8 : 0.5,
        interview_readiness: legacy.readiness.readiness_score,
      },
      planner_notes: {
        reason_short: legacy.readiness.reason,
        missing_priority: legacy.missing_points,
      },
      dimension_priority_map: defaultPriorityMapForNode(params.currentNode),
      must_dimensions: [...params.currentNode.completion_criteria],
      optional_dimensions: params.currentNode.target_dimensions
        .map((item) => item.id)
        .filter((dimensionId) => !params.currentNode.completion_criteria.includes(dimensionId)),
    };

    const composerBlocks: AskmoreV2ResponseBlock[] = [
      {
        type: "understanding",
        content: legacy.understanding_feedback,
      },
      {
        type: "next_question",
        content: legacy.next_question,
      },
      {
        type: "example_answers",
        items: legacy.example_answers,
      },
    ];

    return {
      extractorResult,
      plannerResult,
      composerBlocks,
    };
  });
}

export async function startAskmoreV2Interview(params: {
  language: AskmoreV2Language;
  workspace_id?: string;
  created_by_user_id?: string | null;
}) {
  const repo = getAskmoreV2Repository();
  const workspaceId = params.workspace_id;
  const activeFlow = await repo.getActiveFlowVersion(workspaceId);
  if (!activeFlow) {
    throw new Error("No published askmore_v2 flow found. Please publish a flow from Builder first.");
  }

  const canonicalFlow = toCanonicalFlowDefinition(activeFlow.flow_jsonb);
  const questions = canonicalFlow.final_flow_questions;
  if (questions.length === 0) {
    throw new Error("Published flow has no final interview questions.");
  }

  const nodes = await compileQuestionNodes({
    questions,
    scenario: canonicalFlow.scenario,
    targetOutputType: canonicalFlow.target_output_type,
    language: params.language,
  });

  const now = new Date().toISOString();
  const sessionId = randomUUID();
  const state = buildInitialState({
    questions,
    nodes,
  });

  const openingQuestion = nodes[questions[0].question_id]?.user_facing_entry ?? questions[0].entry_question;
  const openingExamples = await generateExampleAnswers({
    language: params.language,
    question: openingQuestion,
    scenario: canonicalFlow.scenario,
    targetOutputType: canonicalFlow.target_output_type,
    knownContext: [],
  });

  const openingLines = [
    params.language === "zh"
      ? "我们从简单开始，我会边问边理解你的回答。"
      : "Let's start simple. I will ask step by step and reflect my understanding.",
    params.language === "zh" ? `我们先看这一点：${openingQuestion}` : `Let's start with this: ${openingQuestion}`,
    params.language === "zh" ? "你可以这样回答：" : "You can answer like this:",
    ...openingExamples.slice(0, 4).map((item) => `- ${item}`),
  ];

  const openingTurn = openingLines.join("\n\n");

  const session: AskmoreV2Session = {
    id: sessionId,
    flow_version_id: activeFlow.id,
    workspace_id: workspaceId,
    created_by_user_id: params.created_by_user_id ?? null,
    status: "in_progress",
    turn_count: 0,
    state_version: 1,
    state_jsonb: state,
    created_at: now,
    updated_at: now,
  };

  await repo.createSession(session);
  await persistAssistantMessage({
    sessionId,
    content: openingTurn,
  });

  return {
    session_id: sessionId,
    flow_version_id: activeFlow.id,
    opening_turn: openingTurn,
    state,
  };
}

export async function generateAskmoreV2Summary(params: {
  sessionId: string;
  language: AskmoreV2Language;
  mode: "progressive" | "final";
  workspace_id?: string;
}) {
  const repo = getAskmoreV2Repository();
  const workspaceId = params.workspace_id;
  const session = await repo.getSession(params.sessionId, workspaceId);
  if (!session) throw new Error("Session not found");

  const messages = await repo.listMessages(params.sessionId, 120);
  const summary = await generateInterviewSummary({
    language: params.language,
    mode: params.mode,
    session,
    messages,
  });

  session.state_jsonb.session.summary_generated = true;
  session.state_jsonb.latest_summary_text = summary.summary_text;
  session.state_jsonb.latest_structured_report = summary.structured_report_json;
  session.updated_at = new Date().toISOString();

  if (params.mode === "final") {
    session.state_jsonb.session.finalized = true;
    session.status = "completed";
  }

  await repo.updateSession(session);

  if (params.mode === "final") {
    await tryAutoGenerateInsightOnCompletion({
      sessionId: params.sessionId,
      language: params.language,
      workspaceId,
    });
  }

  await persistAssistantMessage({
    sessionId: params.sessionId,
    content: summary.summary_text,
  });

  return summary;
}

/**
 * Legacy turn runtime kept only for compatibility tests and migration reference.
 * Main turn path is SessionRuntimeManager -> SessionRun.executeTurn.
 * No new production logic should be added here.
 */
export async function handleAskmoreV2Turn(params: {
  sessionId: string;
  userMessage: string;
  language: AskmoreV2Language;
  choice?: AskmoreV2TurnChoiceInput;
}) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "ASKMORE_V2_LEGACY_TURN_PATH_DISABLED: use SessionRuntimeManager.enqueueTurn via /api/askmore_v2/interview/turn",
    );
  }
  const repo = getAskmoreV2Repository();
  const session = await repo.getSession(params.sessionId);
  if (!session) throw new Error("Session not found");
  const flow = await repo.getFlowVersion(session.flow_version_id);
  if (!flow) throw new Error("Flow version not found");
  const canonicalFlow = toCanonicalFlowDefinition(flow.flow_jsonb);
  const questions = canonicalFlow.final_flow_questions;

  await ensureNodesInitialized({
    state: session.state_jsonb,
    questions,
    scenario: canonicalFlow.scenario,
    targetOutputType: canonicalFlow.target_output_type,
    language: params.language,
  });

  debugVerbose("turn_received", {
    session_id: params.sessionId,
    turn_count_before: session.turn_count,
    language: params.language,
    user_message: params.userMessage,
    has_choice: Boolean(params.choice),
    choice: params.choice ?? null,
  });

  await repo.addMessage({
    id: randomUUID(),
    session_id: params.sessionId,
    role: "user",
    message_text: params.userMessage,
    created_at: new Date().toISOString(),
  });

  if (session.state_jsonb.session.pending_end_confirmation) {
    if (isShowSummarySignal(params.userMessage)) {
      const summary = await generateAskmoreV2Summary({
        sessionId: params.sessionId,
        language: params.language,
        mode: "progressive",
      });
      const updatedState = (await repo.getSession(params.sessionId))?.state_jsonb ?? session.state_jsonb;
      return {
        understanding_feedback: params.language === "zh"
          ? "这是当前阶段总结，不会结束访谈。你可以继续补充。"
          : "Here is the current summary. Interview remains open and you can continue.",
        answer_status: "partial" as const,
        missing_points: updatedState.session.last_missing_points,
        suggested_next_action: "show_summary" as const,
        next_question: null,
        example_answers: [],
        summary_patch: {},
        readiness: {
          readiness_score: 0.86,
          can_generate_summary: true,
          should_end_early: false,
          reason: params.language === "zh" ? "用户查看阶段总结后可继续补充。" : "User viewed progressive summary and may continue.",
        },
        response_blocks: [
          {
            type: "node_summary" as const,
            content: summary.summary_text,
          },
        ],
        planner_action: "offer_early_summary" as const,
        node_status: null,
        node_progress: null,
        node_summary: summary.summary_text,
        summary_text: summary.summary_text,
        structured_report_json: summary.structured_report_json,
        state: updatedState,
        assistant_message: summary.summary_text,
        turn_count: session.turn_count,
        status: updatedState.session.finalized ? "completed" as const : "in_progress" as const,
      };
    }

    if (isContinueSignal(params.userMessage)) {
      session.state_jsonb.session.pending_end_confirmation = false;
      session.updated_at = new Date().toISOString();
      await repo.updateSession(session);

      const activeQuestion = activeQuestionById(questions, session.state_jsonb.session.current_question_id);
      const node = activeQuestion ? session.state_jsonb.nodes[activeQuestion.question_id] : null;
      const nextQuestion = node?.user_facing_entry ?? activeQuestion?.entry_question ?? null;
      const examples = nextQuestion
        ? await generateExampleAnswers({
            language: params.language,
            question: nextQuestion,
            scenario: canonicalFlow.scenario,
            targetOutputType: canonicalFlow.target_output_type,
            knownContext: Object.values(toKnowledgeValues(session.state_jsonb)).map((value) => String(value)).slice(0, 5),
          })
        : [];

      const responseBlocks: AskmoreV2ResponseBlock[] = [
        {
          type: "understanding",
          content: params.language === "zh" ? "好的，我们继续补充。" : "Great, let's continue.",
        },
      ];
      if (nextQuestion) {
        responseBlocks.push({
          type: "next_question",
          content: nextQuestion,
        });
      }
      if (examples.length > 0) {
        responseBlocks.push({
          type: "example_answers",
          items: examples,
        });
      }

      const assistantMessage = composeAssistantMessage({
        language: params.language,
        blocks: responseBlocks,
      });
      await persistAssistantMessage({ sessionId: params.sessionId, content: assistantMessage });

      return {
        understanding_feedback: params.language === "zh" ? "好的，我们继续补充。" : "Great, let's continue.",
        answer_status: "partial" as const,
        missing_points: session.state_jsonb.session.last_missing_points,
        suggested_next_action: "advance_to_next_question" as const,
        next_question: nextQuestion,
        example_answers: examples,
        summary_patch: {},
        readiness: {
          readiness_score: 0.6,
          can_generate_summary: true,
          should_end_early: false,
          reason: params.language === "zh" ? "用户选择继续补充。" : "User chose to continue.",
        },
        response_blocks: responseBlocks,
        planner_action: "micro_confirm_then_advance" as const,
        node_status: activeQuestion ? session.state_jsonb.node_runtime[activeQuestion.question_id]?.node_status ?? null : null,
        node_progress: null,
        node_summary: null,
        state: session.state_jsonb,
        assistant_message: assistantMessage,
        turn_count: session.turn_count,
        status: session.status,
      };
    }
  }

  if (isSummaryRequest(params.userMessage)) {
    const summary = await generateAskmoreV2Summary({
      sessionId: params.sessionId,
      language: params.language,
      mode: session.state_jsonb.session.finalized ? "final" : "progressive",
    });

    return {
      understanding_feedback: params.language === "zh" ? "好的，这是当前总结。" : "Sure, here is the current summary.",
      answer_status: "partial" as const,
      missing_points: session.state_jsonb.session.last_missing_points,
      suggested_next_action: "show_summary" as const,
      next_question: null,
      example_answers: [],
      summary_patch: {},
      readiness: {
        readiness_score: 0.8,
        can_generate_summary: true,
        should_end_early: false,
        reason: params.language === "zh" ? "用户主动请求总结。" : "User explicitly requested a summary.",
      },
      response_blocks: [
        {
          type: "node_summary" as const,
          content: summary.summary_text,
        },
      ],
      planner_action: "offer_early_summary" as const,
      node_status: null,
      node_progress: null,
      node_summary: summary.summary_text,
      summary_text: summary.summary_text,
      structured_report_json: summary.structured_report_json,
      state: session.state_jsonb,
      assistant_message: summary.summary_text,
      turn_count: session.turn_count,
      status: session.status,
    };
  }

  const state = session.state_jsonb;
  const currentQuestion = activeQuestionById(questions, state.session.current_question_id);
  if (!currentQuestion) {
    const summary = await generateAskmoreV2Summary({
      sessionId: params.sessionId,
      language: params.language,
      mode: "final",
    });
    return {
      understanding_feedback: params.language === "zh" ? "访谈已完成，以下是最终总结。" : "Interview is complete. Here is the final summary.",
      answer_status: "complete" as const,
      missing_points: [],
      suggested_next_action: "end_interview" as const,
      next_question: null,
      example_answers: [],
      summary_patch: {},
      readiness: {
        readiness_score: 1,
        can_generate_summary: true,
        should_end_early: true,
        reason: params.language === "zh" ? "已无剩余问题。" : "No remaining questions.",
      },
      response_blocks: [
        {
          type: "node_summary" as const,
          content: summary.summary_text,
        },
      ],
      planner_action: "end_interview" as const,
      node_status: null,
      node_progress: null,
      node_summary: summary.summary_text,
      summary_text: summary.summary_text,
      structured_report_json: summary.structured_report_json,
      state: (await repo.getSession(params.sessionId))?.state_jsonb ?? state,
      assistant_message: summary.summary_text,
      turn_count: session.turn_count,
      status: "completed" as const,
    };
  }

  const currentNode = state.nodes[currentQuestion.question_id];
  const nodeRuntime = state.node_runtime[currentQuestion.question_id] ?? makeNodeRuntimeState(currentQuestion.question_id);
  state.node_runtime[currentQuestion.question_id] = nodeRuntime;
  ensureNodeRuntimeDimensionMaps(nodeRuntime);
  ensureDimensionPriorityMapsForNode({
    node: currentNode,
    nodeRuntime,
  });

  const questionProgress = state.question_progress[currentQuestion.question_id] ?? makeQuestionProgress(currentQuestion);
  state.question_progress[currentQuestion.question_id] = questionProgress;

  let extractorResult: AskmoreV2TurnExtractorOutput;
  let plannerResult: AskmoreV2DialoguePlannerOutput;
  let composerBlocksFromLegacy: AskmoreV2ResponseBlock[] | null = null;

  const allowFollowUp = questionProgress.follow_up_count < MAX_FOLLOW_UP_PER_QUESTION;
  const useLegacy = process.env.ASKMORE_V2_USE_LEGACY_TURN_UNDERSTANDING === "1";
  const recentUserTurnsForReplay = [...state.recent_user_turns, params.userMessage].slice(-RECENT_TURN_WINDOW);
  const replayMentions = detectDimensionMentionsInTurns({
    currentNode,
    turns: recentUserTurnsForReplay,
  });
  debugVerbose("mention_detected", {
    question_id: currentQuestion.question_id,
    mentions: Object.fromEntries(
      currentNode.target_dimensions.map((dimension) => [dimension.id, replayMentions[dimension.id] ?? null]),
    ),
  });
  let answeredChanges: string[] = [];
  let repeatRiskContext: { dimension_id: string; acknowledged_value: string; reason: string } | null = null;

  if (useLegacy) {
    const legacy = await legacyIntelligenceFromTurnUnderstanding({
      language: params.language,
      currentNode,
      nodeRuntime,
      userMessage: params.userMessage,
      turnCount: session.turn_count,
      allowFollowUp,
      structuredKnowledge: toKnowledgeValues(state),
    });
    extractorResult = legacy.extractorResult;
    plannerResult = legacy.plannerResult;
    composerBlocksFromLegacy = legacy.composerBlocks;
    answeredChanges = markAnsweredDimensions({
      currentNode,
      nodeRuntime,
      extractorResult,
      replayMentions,
      userMessage: params.userMessage,
    });
    extractorResult.unanswered_dimensions = computeUnansweredDimensions({
      currentNode,
      nodeRuntime,
    });
  } else {
    extractorResult = await extractTurnFacts({
      language: params.language,
      currentNode,
      nodeState: nodeRuntime,
      userMessage: params.userMessage,
    });
    answeredChanges = markAnsweredDimensions({
      currentNode,
      nodeRuntime,
      extractorResult,
      replayMentions,
      userMessage: params.userMessage,
    });
    extractorResult.unanswered_dimensions = computeUnansweredDimensions({
      currentNode,
      nodeRuntime,
    });

    plannerResult = await planDialogueStep({
      language: params.language,
      currentNode,
      nodeState: nodeRuntime,
      extractorResult,
      interviewState: {
        turn_count: session.turn_count,
        total_questions: questions.length,
        completed_questions: Object.values(state.question_progress).filter((item) => item.status === "completed").length,
        pending_end_confirmation: state.session.pending_end_confirmation,
        progressive_summary_available: session.turn_count >= SUMMARY_ALLOWED_FROM_TURN,
      },
    });
  }

  if (
    !params.choice &&
    extractorResult.answer_quality !== "off_topic" &&
    answeredChanges.length === 0 &&
    plannerResult.chosen_dimension_to_ask &&
    !hasUncertaintySignal(params.userMessage) &&
    (params.userMessage.trim().length > SHORT_ANSWER_THRESHOLD || hasTemporalPhrase(params.userMessage))
  ) {
    const promoted = promoteProvisionalMention({
      currentNode,
      nodeRuntime,
      dimensionId: plannerResult.chosen_dimension_to_ask,
      userMessage: params.userMessage,
    });
    if (promoted) {
      answeredChanges = [...new Set([...answeredChanges, plannerResult.chosen_dimension_to_ask])];
      extractorResult.unanswered_dimensions = computeUnansweredDimensions({
        currentNode,
        nodeRuntime,
      });
    }
  }

  const directStructuredPromoted = applyDirectStructuredConfirmation({
    currentNode,
    nodeRuntime,
    userMessage: params.userMessage,
    replayMentions,
    extractorResult,
  });
  if (directStructuredPromoted.length > 0) {
    extractorResult.unanswered_dimensions = computeUnansweredDimensions({
      currentNode,
      nodeRuntime,
    });
  }

  applyPriorityStabilization({
    node: currentNode,
    nodeRuntime,
    plannerResult,
  });

  debugVerbose("answered_promoted", {
    question_id: currentQuestion.question_id,
    answered_changes: answeredChanges,
    direct_structured_promoted: directStructuredPromoted,
    dimension_state: nodeRuntime.dimension_state,
    dimension_priority_current: nodeRuntime.dimension_priority_current,
  });

  debugVerbose("unresolved_reason", {
    question_id: currentQuestion.question_id,
    unresolved_reason_map: nodeRuntime.dimension_unresolved_reason,
  });

  debugVerbose("extractor_and_planner", {
    question_id: currentQuestion.question_id,
    mentioned_dimensions: Object.fromEntries(
      currentNode.target_dimensions.map((dimension) => [dimension.id, replayMentions[dimension.id] ?? null]),
    ),
    answered_changes: answeredChanges,
    answered_map: nodeRuntime.dimension_answered,
    facts_extracted: extractorResult.facts_extracted,
    confidence_by_dimension: nodeRuntime.dimension_confidence,
    unanswered_dimensions: extractorResult.unanswered_dimensions ?? [],
    planner_action: plannerResult.planner_action,
    planner_chosen_dimension: plannerResult.chosen_dimension_to_ask,
  });

  mergeExtractorFactsToNodeRuntime({
    currentNode,
    nodeRuntime,
    extractorResult,
    recentUserTurns: recentUserTurnsForReplay,
    replayMentions,
  });

  if (params.choice) {
    const appliedChoice = applyChoiceToNodeRuntime({
      currentNode,
      nodeRuntime,
      choice: params.choice,
      userMessage: params.userMessage,
    });
    if (appliedChoice.applied && appliedChoice.resolvedValue) {
      extractorResult.facts_extracted[params.choice.dimension_id] = {
        value: appliedChoice.resolvedValue,
        evidence: params.userMessage.trim().slice(0, 120) || params.choice.option_label,
        confidence: MICRO_CONFIRM_CONFIDENCE,
      };
      extractorResult.updated_dimensions = [...new Set([...extractorResult.updated_dimensions, params.choice.dimension_id])];
    }
  }

  const plannerActionBeforeGuard = plannerResult.planner_action;
  const plannerChosenBeforeGuard = plannerResult.chosen_dimension_to_ask;
  const requestedReplayDimension = plannerResult.chosen_dimension_to_ask;
  if (requestedReplayDimension) {
    const replayHit = replayMentions[requestedReplayDimension];
    const extractedChosen = Boolean(extractorResult.facts_extracted[requestedReplayDimension]);
    const alreadyAnswered = getDimensionState({
      nodeRuntime,
      dimensionId: requestedReplayDimension,
    }) !== "unanswered";
    const askedRecently = wasDimensionRecentlyPrompted({
      state,
      questionId: currentQuestion.question_id,
      dimensionId: requestedReplayDimension,
    });
    const userRepeatComplaint = isRepeatComplaint(params.userMessage);

    const shouldAvoidRepeat =
      alreadyAnswered ||
      (askedRecently && (extractedChosen || replayHit?.mentioned)) ||
      (!extractedChosen && Boolean(replayHit?.strong)) ||
      (userRepeatComplaint && Boolean(replayHit?.mentioned));

    if (shouldAvoidRepeat) {
      const coverage = computeCoverageCounts({
        currentNode,
        nodeRuntime,
        extractorResult,
      });
      const unanswered = computeUnansweredDimensions({
        currentNode,
        nodeRuntime,
      }).filter((item) => item !== requestedReplayDimension);
      const canWrapBySoft = coverage.softCovered >= coverage.required;
      const nextAction = canWrapBySoft
        ? "node_wrap_up"
        : "micro_confirm_then_advance";
      const coveredForProgress = Math.max(coverage.hardCovered, coverage.softCovered);
      plannerResult = {
        ...plannerResult,
        node_status: canWrapBySoft ? "complete" : plannerResult.node_status,
        planner_action: nextAction,
        chosen_dimension_to_ask: null,
        should_show_node_summary: nextAction === "node_wrap_up",
        progress_signal: {
          covered_count: coveredForProgress,
          required_count: coverage.required,
          remaining_count: Math.max(0, coverage.required - coveredForProgress),
        },
        planner_notes: {
          ...plannerResult.planner_notes,
          reason_short:
            params.language === "zh"
              ? "检测到用户已回答该点，避免重复追问。"
              : "User already addressed this point, avoid repeated asking.",
          missing_priority: plannerResult.planner_notes.missing_priority.filter((item) => item !== requestedReplayDimension),
        },
      };
      repeatRiskContext = {
        dimension_id: requestedReplayDimension,
        acknowledged_value: params.userMessage.trim().slice(0, 120),
        reason:
          params.language === "zh"
            ? "用户已提供该维度信息，改为确认或推进。"
            : "User already provided this dimension, switch to confirm/advance.",
      };
    }
  }

  debugVerbose("guard_before_after", {
    planner_action_before_guard: plannerActionBeforeGuard,
    planner_chosen_before_guard: plannerChosenBeforeGuard,
    planner_action_after_guard: plannerResult.planner_action,
    planner_chosen_after_guard: plannerResult.chosen_dimension_to_ask,
    answered_map: nodeRuntime.dimension_answered,
  });

  if (plannerResult.planner_action === "node_wrap_up" || plannerResult.should_show_node_summary) {
    const backfilledFacts = backfillNodeFromReplay({
      currentNode,
      nodeRuntime,
      replayMentions,
      latestUserMessage: params.userMessage,
    });
    for (const [dimensionId, fact] of Object.entries(backfilledFacts)) {
      extractorResult.facts_extracted[dimensionId] = fact;
      extractorResult.updated_dimensions = [...new Set([...extractorResult.updated_dimensions, dimensionId])];
    }
    if (Object.keys(backfilledFacts).length > 0) {
      mergeExtractorFactsToNodeRuntime({
        currentNode,
        nodeRuntime,
        extractorResult,
        recentUserTurns: recentUserTurnsForReplay,
        replayMentions,
      });
    }
  }

  questionProgress.times_asked += 1;
  questionProgress.coverage_score = Math.max(questionProgress.coverage_score, coverageFromAnswerQuality(extractorResult.answer_quality));

  extractorResult.unanswered_dimensions = computeUnansweredDimensions({
    currentNode,
    nodeRuntime,
  });
  const answerStatus = mapAnswerStatusFromQuality(extractorResult.answer_quality);
  let resolvedCurrentQuestion = false;
  let nodeSummaryText: string | null = null;
  let microConfirmDimensionId: string | null = null;
  let microConfirmPayload: {
    ack_text: string;
    options: AskmoreV2MicroConfirmOption[];
    allow_free_text: boolean;
  } | null = null;

  let unansweredMustDimensions = computeUnansweredMustDimensions({
    currentNode,
    nodeRuntime,
  });
  if (unansweredMustDimensions.length > 0 && questionProgress.follow_up_count >= MAX_FOLLOW_UP_PER_QUESTION) {
    downgradeMustDimensionsByLimit({
      currentNode,
      nodeRuntime,
      dimensionIds: unansweredMustDimensions,
      reason: params.language === "zh"
        ? "达到追问上限，自动降级为可选。"
        : "Follow-up limit reached, automatically downgraded to optional.",
    });
    const downgradedMap = getCurrentPriorityMap({
      node: currentNode,
      nodeRuntime,
    });
    const downgradedLists = derivePriorityLists({
      node: currentNode,
      priorityMap: downgradedMap,
    });
    plannerResult = {
      ...plannerResult,
      dimension_priority_map: downgradedMap,
      must_dimensions: downgradedLists.mustDimensions,
      optional_dimensions: downgradedLists.optionalDimensions,
      planner_notes: {
        ...plannerResult.planner_notes,
        reason_short: params.language === "zh"
          ? "关键维度在追问上限后降级为可选，继续推进。"
          : "Required dimensions downgraded to optional after follow-up limit.",
      },
    };
    unansweredMustDimensions = computeUnansweredMustDimensions({
      currentNode,
      nodeRuntime,
    });
    debugVerbose("must_dimension_downgraded_by_limit", {
      question_id: currentQuestion.question_id,
      downgraded_dimensions: Object.entries(nodeRuntime.dimension_priority_downgraded_by_limit ?? {})
        .filter(([, downgraded]) => Boolean(downgraded))
        .map(([dimensionId]) => dimensionId),
    });
  }
  if (unansweredMustDimensions.length > 0) {
    const forcedMustDimension = unansweredMustDimensions[0];
    const missingPriority = [
      forcedMustDimension,
      ...plannerResult.planner_notes.missing_priority.filter((id) => id !== forcedMustDimension),
    ];
    plannerResult = {
      ...plannerResult,
      node_status: "partial",
      planner_action: "micro_confirm_then_clarify",
      chosen_dimension_to_ask: forcedMustDimension,
      should_show_node_summary: false,
      should_offer_early_summary: false,
      planner_notes: {
        ...plannerResult.planner_notes,
        reason_short: params.language === "zh"
          ? "仍有必问维度未回答，先补关键点。"
          : "A required dimension is still unanswered; clarify it first.",
        missing_priority: missingPriority,
      },
    };
    debugVerbose("must_dimension_guard", {
      question_id: currentQuestion.question_id,
      forced_dimension: forcedMustDimension,
      unanswered_must_dimensions: unansweredMustDimensions,
    });
  }

  const requestedClarify = plannerResult.planner_action === "micro_confirm_then_clarify" && plannerResult.chosen_dimension_to_ask;
  const canClarify = questionProgress.follow_up_count < MAX_FOLLOW_UP_PER_QUESTION && session.turn_count < MAX_QUESTION_COUNT;
  let shouldClarify = Boolean(requestedClarify && canClarify);
  if (requestedClarify) {
    const stateForRequested = getDimensionState({
      nodeRuntime,
      dimensionId: requestedClarify,
    });
    if (stateForRequested !== "unanswered") {
      shouldClarify = false;
      plannerResult = {
        ...plannerResult,
        planner_action: "micro_confirm_then_advance",
        chosen_dimension_to_ask: null,
      };
    }
  }

  let forcedMicroConfirmFromClarify = false;
  const requestedClarifyPriority = requestedClarify
    ? nodeRuntime.dimension_priority_current?.[requestedClarify] ?? "optional"
    : "optional";
  const requestedClarifyUnresolvedReason = requestedClarify
    ? nodeRuntime.dimension_unresolved_reason?.[requestedClarify] ?? null
    : null;
  if (
    !params.choice &&
    shouldClarify &&
    requestedClarify &&
    requestedClarifyPriority === "must" &&
    isHighRiskUnresolvedReason(requestedClarifyUnresolvedReason) &&
    !nodeRuntime.dimension_micro_confirmed[requestedClarify] &&
    answeredChanges.length > 0
  ) {
    microConfirmDimensionId = requestedClarify;
    shouldClarify = false;
    forcedMicroConfirmFromClarify = true;
    plannerResult = {
      ...plannerResult,
      planner_action: "micro_confirm_then_advance",
      chosen_dimension_to_ask: null,
    };
  }

  extractorResult.missing_dimensions = computeMissingDimensionsFromHard({
    currentNode,
    nodeRuntime,
    extractorResult,
  });

  if (!microConfirmDimensionId) {
    const preferredMicroConfirmDimensions = [
      requestedClarify || null,
      requestedReplayDimension || null,
      plannerChosenBeforeGuard || null,
      plannerResult.chosen_dimension_to_ask || null,
      ...answeredChanges,
    ];
    const microConfirmCandidate = findMicroConfirmCandidate({
      currentNode,
      nodeRuntime,
      choice: params.choice,
      preferredDimensionIds: preferredMicroConfirmDimensions,
    });

    if (microConfirmCandidate && !params.choice) {
      microConfirmDimensionId = microConfirmCandidate.dimension.id;
      debugVerbose("micro_confirm_candidate", {
        question_id: currentQuestion.question_id,
        selected_dimension_id: microConfirmDimensionId,
        selected_from: microConfirmCandidate.source,
        preferred_dimension_ids: preferredMicroConfirmDimensions.filter(Boolean),
      });
      shouldClarify = false;
      plannerResult = {
        ...plannerResult,
        planner_action: "micro_confirm_then_advance",
        chosen_dimension_to_ask: null,
      };
    }
  } else if (forcedMicroConfirmFromClarify) {
    debugVerbose("micro_confirm_candidate", {
      question_id: currentQuestion.question_id,
      selected_dimension_id: microConfirmDimensionId,
      selected_from: "requested_clarify_assist",
      preferred_dimension_ids: [requestedClarify].filter(Boolean),
    });
  }

  if (shouldClarify) {
    questionProgress.status = "partial";
    questionProgress.follow_up_count += 1;
    nodeRuntime.clarify_count += 1;
    state.session.current_sub_question_index += 1;
    nodeRuntime.node_status = plannerResult.node_status === "not_started" ? "partial" : plannerResult.node_status;
    if (plannerResult.chosen_dimension_to_ask) {
      rememberPromptedDimension({
        state,
        questionId: currentQuestion.question_id,
        dimensionId: plannerResult.chosen_dimension_to_ask,
      });
    }
  } else if (microConfirmDimensionId) {
    questionProgress.status = "partial";
    setDimensionState({
      nodeRuntime,
      dimensionId: microConfirmDimensionId,
      state: "micro_confirm_pending",
      unresolvedReason: nodeRuntime.dimension_unresolved_reason?.[microConfirmDimensionId] ?? "semantic_unmapped",
    });
    nodeRuntime.node_status = plannerResult.node_status === "not_started" ? "partial" : plannerResult.node_status;
  } else {
    resolvedCurrentQuestion = true;
    if (answerStatus === "off_topic" && Object.keys(nodeRuntime.captured_dimensions).length === 0) {
      questionProgress.status = "skipped";
      nodeRuntime.node_status = "partial";
    } else {
      questionProgress.status = plannerResult.node_status === "complete" || answerStatus === "complete" ? "completed" : "partial";
      nodeRuntime.node_status = plannerResult.node_status === "complete" || questionProgress.status === "completed" ? "complete" : "partial";
    }

    if (plannerResult.should_show_node_summary || nodeRuntime.node_status === "complete") {
      nodeSummaryText = buildNodeSummary({
        language: params.language,
        currentNode,
        nodeRuntime,
      });
      if (nodeSummaryText) {
        nodeRuntime.last_node_summary = nodeSummaryText;
      }
    }
  }

  const summaryPatch = buildSummaryPatchFromExtractor({
    questionId: currentQuestion.question_id,
    extractorResult,
  });

  mergeSummaryPatch({
    now: new Date().toISOString(),
    state,
    patch: summaryPatch,
    confidence: Math.max(0.45, extractorResult.confidence_overall),
    confirmed: answerStatus === "complete",
  });

  const unansweredDimensionLabels = (extractorResult.unanswered_dimensions ?? []).map((dimensionId) =>
    dimensionLabel(currentNode, dimensionId),
  );
  const missingDimensionLabels = unansweredDimensionLabels.length > 0
    ? unansweredDimensionLabels
    : extractorResult.missing_dimensions.map((dimensionId) => dimensionLabel(currentNode, dimensionId));
  state.session.last_missing_points = missingDimensionLabels;
  rememberUserTurn({
    state,
    userMessage: params.userMessage,
  });

  if (resolvedCurrentQuestion) {
    state.session.current_sub_question_index = 0;
    state.session.current_question_id = nextQuestionId(questions, currentQuestion.question_id);
  }

  session.turn_count += 1;

  const answeredQuestionCount = Object.values(state.question_progress)
    .filter((progress) => progress.status === "completed").length;

  const completionReadiness = await judgeCompletion({
    language: params.language,
    turnCount: session.turn_count,
    answeredQuestionCount,
    totalQuestionCount: questions.length,
    missingPoints: state.session.last_missing_points,
    structuredKnowledge: toKnowledgeValues(state),
  });

  const readiness = {
    readiness_score: Math.max(completionReadiness.readiness_score, plannerResult.readiness.interview_readiness),
    can_generate_summary: completionReadiness.can_generate_summary || plannerResult.should_offer_early_summary,
    should_end_early:
      completionReadiness.should_end_early ||
      plannerResult.should_offer_early_summary ||
      plannerResult.planner_action === "end_interview",
    reason: completionReadiness.reason,
  };

  const allQuestionsDone = allMainQuestionsCompleted({
    questions,
    state,
  });
  const allMustAnswered = allCurrentMustDimensionsAnswered({
    questions,
    state,
  });
  const allowFinalEnd = allQuestionsDone && allMustAnswered;

  if (!allowFinalEnd && plannerResult.planner_action === "end_interview") {
    plannerResult = {
      ...plannerResult,
      planner_action: "micro_confirm_then_advance",
      should_offer_early_summary: session.turn_count >= SUMMARY_ALLOWED_FROM_TURN,
      should_show_node_summary: false,
      planner_notes: {
        ...plannerResult.planner_notes,
        reason_short: params.language === "zh"
          ? "仍有主问题未完成，改为阶段总结/继续推进。"
          : "Main questions are not fully completed yet; use progressive summary/advance.",
      },
    };
  }
  if (!allowFinalEnd) {
    readiness.should_end_early = false;
  }

  let nextQuestionText: string | null = null;
  let nextExamples: string[] = [];
  let summaryText: string | null = null;
  let structuredReport: Record<string, unknown> | null = null;

  const reachedHardLimit = session.turn_count >= MAX_QUESTION_COUNT;
  const noQuestionLeft = !state.session.current_question_id;
  const aiAutoComplete =
    session.status !== "completed" &&
    session.turn_count >= SUMMARY_ALLOWED_FROM_TURN &&
    readiness.can_generate_summary &&
    readiness.should_end_early &&
    allowFinalEnd;

  debugVerbose("final_end_guard", {
    session_id: params.sessionId,
    all_questions_done: allQuestionsDone,
    all_must_answered: allMustAnswered,
    allow_final_end: allowFinalEnd,
    readiness_should_end_early: readiness.should_end_early,
    planner_action: plannerResult.planner_action,
  });

  if (reachedHardLimit || noQuestionLeft || aiAutoComplete) {
    const summary = await generateInterviewSummary({
      language: params.language,
      mode: "final",
      session,
      messages: await repo.listMessages(params.sessionId, 120),
    });
    summaryText = summary.summary_text;
    structuredReport = summary.structured_report_json;
    state.session.summary_generated = true;
    state.latest_summary_text = summary.summary_text;
    state.latest_structured_report = summary.structured_report_json;
    state.session.finalized = true;
    session.status = "completed";
    state.session.current_question_id = null;
    state.session.pending_end_confirmation = false;
  } else {
    if (microConfirmDimensionId) {
      const microDimensionLabel = dimensionLabel(currentNode, microConfirmDimensionId);
      const microEvidence =
        nodeRuntime.dimension_answered_evidence[microConfirmDimensionId] ||
        params.userMessage.trim().slice(0, 120);
      microConfirmPayload = await generateMicroConfirmation({
        language: params.language,
        dimensionId: microConfirmDimensionId,
        dimensionLabel: microDimensionLabel,
        userEvidence: microEvidence,
        candidateValue: nodeRuntime.captured_dimensions[microConfirmDimensionId] ?? null,
        unresolvedReason: nodeRuntime.dimension_unresolved_reason?.[microConfirmDimensionId] ?? null,
      });
      nodeRuntime.dimension_micro_confirmed[microConfirmDimensionId] = true;
      nodeRuntime.last_micro_confirm_offer = {
        dimension_id: microConfirmDimensionId,
        options: microConfirmPayload.options,
        offered_at_turn: session.turn_count,
      };
      nextQuestionText = null;
      debugVerbose("micro_confirm_triggered", {
        question_id: currentQuestion.question_id,
        dimension_id: microConfirmDimensionId,
        options: microConfirmPayload.options,
      });
    } else if (shouldClarify) {
      nextQuestionText = buildClarifyQuestion({
        language: params.language,
        currentNode,
        dimensionId: plannerResult.chosen_dimension_to_ask,
      });
    } else {
      const activeNextQuestion = activeQuestionById(questions, state.session.current_question_id);
      if (activeNextQuestion) {
        nextQuestionText = state.nodes[activeNextQuestion.question_id]?.user_facing_entry ?? activeNextQuestion.entry_question;
      }
    }

    if (session.turn_count >= SUMMARY_ALLOWED_FROM_TURN) {
      const progressive = await generateInterviewSummary({
        language: params.language,
        mode: "progressive",
        session,
        messages: await repo.listMessages(params.sessionId, 120),
      });
      state.session.summary_generated = true;
      state.latest_summary_text = progressive.summary_text;
      state.latest_structured_report = progressive.structured_report_json;
      summaryText = progressive.summary_text;
      structuredReport = progressive.structured_report_json;
    }
  }
  state.session.pending_end_confirmation = false;

  let responseBlocks: AskmoreV2ResponseBlock[] = [];
  if (session.status === "completed") {
    responseBlocks = [
      {
        type: "node_summary",
        content: summaryText ?? (params.language === "zh" ? "访谈结束。" : "Interview complete."),
      },
    ];
  } else if (composerBlocksFromLegacy) {
    responseBlocks = composerBlocksFromLegacy;
    if (repeatRiskContext) {
      responseBlocks.unshift({
        type: "understanding",
        content:
          params.language === "zh"
            ? `我先把你刚刚说的记为：${repeatRiskContext.acknowledged_value}`
            : `I will first take what you just said as: ${repeatRiskContext.acknowledged_value}`,
      });
    }
    if (nodeSummaryText) {
      responseBlocks.unshift({
        type: "node_summary",
        content: nodeSummaryText,
      });
    }
    if (nextQuestionText) {
      const hasNext = responseBlocks.some((block) => block.type === "next_question");
      if (!hasNext) {
        responseBlocks.push({
          type: "next_question",
          content: nextQuestionText,
        });
      }
    }
  } else {
    const composed = await composeTurnResponse({
      language: params.language,
      currentNode,
      extractorResult,
      plannerResult,
      nextQuestionText,
      nodeSummaryText,
      repeatRiskContext,
    });
    responseBlocks = [...composed.response_blocks];

    if (repeatRiskContext) {
      const repeatAck =
        params.language === "zh"
          ? `我先把你刚刚说的记为：${repeatRiskContext.acknowledged_value}`
          : `I will first take what you just said as: ${repeatRiskContext.acknowledged_value}`;
      if (!responseBlocks.some((block) => block.type === "understanding" && (block.content ?? "").includes(repeatRiskContext.acknowledged_value))) {
        responseBlocks.unshift({
          type: "understanding",
          content: repeatAck,
        });
      }
    }

    if (nodeSummaryText && !responseBlocks.some((block) => block.type === "node_summary")) {
      responseBlocks.unshift({
        type: "node_summary",
        content: nodeSummaryText,
      });
    }

    if (nextQuestionText && !responseBlocks.some((block) => block.type === "next_question")) {
      responseBlocks.push({
        type: "next_question",
        content: nextQuestionText,
      });
    }
  }

  if (microConfirmPayload && microConfirmDimensionId) {
    const hasAck = responseBlocks.some((block) => block.type === "understanding");
    if (!hasAck) {
      responseBlocks.unshift({
        type: "understanding",
        content: microConfirmPayload.ack_text,
      });
    } else {
      responseBlocks = responseBlocks.map((block) => {
        if (block.type !== "understanding") return block;
        return {
          ...block,
          content: `${microConfirmPayload.ack_text}\n\n${block.content ?? ""}`.trim(),
        };
      });
    }

    const dimensionIndex = currentNode.target_dimensions.findIndex((item) => item.id === microConfirmDimensionId);
    const subQuestionText = dimensionIndex >= 0 ? currentQuestion.sub_questions[dimensionIndex] ?? null : null;
    const microConfirmQuestionText =
      subQuestionText ??
      buildClarifyQuestion({
        language: params.language,
        currentNode,
        dimensionId: microConfirmDimensionId,
      }) ??
      (params.language === "zh"
        ? `当前确认点：${dimensionLabel(currentNode, microConfirmDimensionId)}`
        : `Current point to confirm: ${dimensionLabel(currentNode, microConfirmDimensionId)}`);

    responseBlocks = responseBlocks.filter((block) => block.type !== "next_question" && block.type !== "example_answers");
    responseBlocks.push({
      type: "micro_confirm_options",
      content: microConfirmQuestionText,
      dimension_id: microConfirmDimensionId,
      options: microConfirmPayload.options,
      allow_free_text: microConfirmPayload.allow_free_text,
    });
  }

  let exampleAnswers = blockItems(responseBlocks, "example_answers");
  if (exampleAnswers.length === 0 && nextQuestionText && session.status !== "completed") {
    nextExamples = await generateExampleAnswers({
      language: params.language,
      question: nextQuestionText,
      scenario: canonicalFlow.scenario,
      targetOutputType: canonicalFlow.target_output_type,
      knownContext: Object.values(toKnowledgeValues(state)).map((value) => String(value)).slice(0, 5),
    });
    exampleAnswers = nextExamples;
    responseBlocks.push({
      type: "example_answers",
      items: exampleAnswers,
    });
  }

  const understandingFeedback =
    blockContent(responseBlocks, "understanding") ??
    (params.language === "zh" ? "我先接住你刚刚的回答。" : "I got your latest response.");
  state.session.last_understanding_feedback = understandingFeedback;

  const assistantMessage = composeAssistantMessage({
    language: params.language,
    blocks: responseBlocks,
  }) || understandingFeedback;

  session.state_jsonb = state;
  session.updated_at = new Date().toISOString();
  await repo.updateSession(session);
  await persistAssistantMessage({
    sessionId: params.sessionId,
    content: assistantMessage,
  });

  const plannerActionFinal = session.status === "completed"
    ? "end_interview"
    : requestedClarify && !canClarify
        ? "micro_confirm_then_advance"
      : shouldClarify
        ? "micro_confirm_then_clarify"
        : plannerResult.planner_action;

  const legacySuggestedNextAction = plannerActionToLegacyNextAction({
    plannerAction: plannerActionFinal,
    shouldClarify,
    shouldAskSummaryChoice: false,
    status: session.status,
  });

  const nodeProgress = {
    covered: plannerResult.progress_signal.covered_count,
    required: plannerResult.progress_signal.required_count,
    remaining: plannerResult.progress_signal.remaining_count,
  };

  debugVerbose("turn_decision", {
    session_id: params.sessionId,
    turn_count_after: session.turn_count,
    status: session.status,
    should_clarify: shouldClarify,
    micro_confirm_dimension_id: microConfirmDimensionId,
    planner_action_final: plannerActionFinal,
    suggested_next_action: legacySuggestedNextAction,
    missing_dimensions: extractorResult.missing_dimensions,
    unanswered_dimensions: extractorResult.unanswered_dimensions ?? [],
    last_missing_points: missingDimensionLabels,
  });

  return {
    understanding_feedback: understandingFeedback,
    answer_status: answerStatus,
    missing_points: missingDimensionLabels,
    suggested_next_action: legacySuggestedNextAction,
    next_question: blockContent(responseBlocks, "next_question") ?? nextQuestionText,
    example_answers: exampleAnswers,
    summary_patch: summaryPatch,
    readiness,
    response_blocks: responseBlocks,
    planner_action: plannerActionFinal,
    node_status: nodeRuntime.node_status,
    node_progress: nodeProgress,
    node_summary: nodeSummaryText,
    summary_text: summaryText,
    structured_report_json: structuredReport,
    state,
    assistant_message: assistantMessage,
    turn_count: session.turn_count,
    status: session.status,
  };
}

export const handleAskmoreV2TurnLegacy = handleAskmoreV2Turn;
