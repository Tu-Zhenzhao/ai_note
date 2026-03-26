import {
  AskmoreV2NodeRuntimeState,
  AskmoreV2QuestionNode,
  AskmoreV2SessionState,
  AskmoreV2TurnExtractorOutput,
} from "@/server/askmore_v2/types";

const CONFIRMED_THRESHOLD = 0.72;

function ensureNodeRuntimeMaps(nodeRuntime: AskmoreV2NodeRuntimeState) {
  if (!nodeRuntime.dimension_state) nodeRuntime.dimension_state = {};
  if (!nodeRuntime.dimension_unresolved_reason) nodeRuntime.dimension_unresolved_reason = {};
  if (!nodeRuntime.dimension_answered) nodeRuntime.dimension_answered = {};
  if (!nodeRuntime.dimension_answered_evidence) nodeRuntime.dimension_answered_evidence = {};
  if (!nodeRuntime.dimension_micro_confirmed) nodeRuntime.dimension_micro_confirmed = {};
  if (!nodeRuntime.dimension_confidence) nodeRuntime.dimension_confidence = {};
  if (!nodeRuntime.dimension_soft_confidence) nodeRuntime.dimension_soft_confidence = {};
  if (!nodeRuntime.captured_dimensions) nodeRuntime.captured_dimensions = {};
}

export function applyExtractorToCoverage(params: {
  state: AskmoreV2SessionState;
  questionId: string;
  node: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  extractor: AskmoreV2TurnExtractorOutput;
  now: string;
}): {
  updatedDimensions: string[];
  coveredMustCount: number;
  requiredMustCount: number;
  unresolvedDimensionIds: string[];
} {
  ensureNodeRuntimeMaps(params.nodeRuntime);

  const validDimensionIds = new Set(params.node.target_dimensions.map((item) => item.id));
  const updatedDimensions: string[] = [];

  for (const [dimensionId, fact] of Object.entries(params.extractor.facts_extracted)) {
    if (!validDimensionIds.has(dimensionId)) continue;

    const confidence = Math.max(Number(params.nodeRuntime.dimension_confidence[dimensionId] ?? 0), Number(fact.confidence ?? 0));
    params.nodeRuntime.captured_dimensions[dimensionId] = fact.value;
    params.nodeRuntime.dimension_answered[dimensionId] = true;
    params.nodeRuntime.dimension_answered_evidence[dimensionId] = fact.evidence;
    params.nodeRuntime.dimension_confidence[dimensionId] = confidence;
    params.nodeRuntime.dimension_soft_confidence[dimensionId] = Math.max(
      Number(params.nodeRuntime.dimension_soft_confidence[dimensionId] ?? 0),
      Math.min(0.95, confidence + 0.08),
    );

    if (confidence >= CONFIRMED_THRESHOLD) {
      params.nodeRuntime.dimension_state![dimensionId] = "structured_confirmed";
      params.nodeRuntime.dimension_unresolved_reason![dimensionId] = null;
    } else {
      params.nodeRuntime.dimension_state![dimensionId] = "answered_unstructured";
      params.nodeRuntime.dimension_unresolved_reason![dimensionId] = "semantic_unmapped";
    }

    params.state.structured_knowledge[`${params.questionId}__${dimensionId}`] = {
      value: fact.value,
      confidence,
      confirmed: confidence >= CONFIRMED_THRESHOLD,
      updated_at: params.now,
    };

    updatedDimensions.push(dimensionId);
  }

  const requiredMustCount = Math.max(1, params.node.completion_criteria.length);
  let coveredMustCount = 0;
  for (const dimensionId of params.node.completion_criteria) {
    const confidence = Number(params.nodeRuntime.dimension_confidence[dimensionId] ?? 0);
    if (confidence >= 0.6) coveredMustCount += 1;
  }

  const unresolvedDimensionIds = params.node.target_dimensions
    .map((item) => item.id)
    .filter((dimensionId) => Number(params.nodeRuntime.dimension_confidence[dimensionId] ?? 0) < 0.6);

  return {
    updatedDimensions,
    coveredMustCount,
    requiredMustCount,
    unresolvedDimensionIds,
  };
}
