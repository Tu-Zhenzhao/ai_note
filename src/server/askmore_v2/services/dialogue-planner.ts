import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2DialoguePlannerPrompt } from "@/server/askmore_v2/prompts";
import {
  AskmoreV2DimensionPriority,
  AskmoreV2DialoguePlannerOutput,
  AskmoreV2Language,
  AskmoreV2NodeRuntimeState,
  AskmoreV2QuestionNode,
  AskmoreV2TurnExtractorOutput,
} from "@/server/askmore_v2/types";

const schema = z.object({
  node_status: z.enum(["not_started", "partial", "complete"]),
  planner_action: z.enum([
    "micro_confirm_then_clarify",
    "micro_confirm_then_advance",
    "node_wrap_up",
    "offer_early_summary",
    "end_interview",
  ]),
  chosen_dimension_to_ask: z.string().nullable(),
  should_show_micro_confirmation: z.boolean(),
  should_use_hypothesis_style: z.boolean(),
  should_show_node_summary: z.boolean(),
  should_offer_early_summary: z.boolean(),
  progress_signal: z.object({
    covered_count: z.number().int().min(0),
    required_count: z.number().int().min(0),
    remaining_count: z.number().int().min(0),
  }),
  readiness: z.object({
    node_readiness: z.number().min(0).max(1),
    interview_readiness: z.number().min(0).max(1),
  }),
  planner_notes: z.object({
    reason_short: z.string().min(1),
    missing_priority: z.array(z.string().min(1)).default([]),
  }),
  dimension_priority_map: z.record(z.string(), z.enum(["must", "optional"])).default({}),
  must_dimensions: z.array(z.string().min(1)).default([]),
  optional_dimensions: z.array(z.string().min(1)).default([]),
});

function defaultPriorityMap(node: AskmoreV2QuestionNode): Record<string, AskmoreV2DimensionPriority> {
  const map: Record<string, AskmoreV2DimensionPriority> = {};
  const mustSet = new Set(node.completion_criteria);
  for (const dimension of node.target_dimensions) {
    map[dimension.id] = mustSet.has(dimension.id) ? "must" : "optional";
  }
  return map;
}

function normalizePriorityOutput(params: {
  node: AskmoreV2QuestionNode;
  nodeState: AskmoreV2NodeRuntimeState;
  candidateMap?: Record<string, AskmoreV2DimensionPriority>;
  candidateMust?: string[];
  candidateOptional?: string[];
}): {
  dimension_priority_map: Record<string, AskmoreV2DimensionPriority>;
  must_dimensions: string[];
  optional_dimensions: string[];
} {
  const validIds = new Set(params.node.target_dimensions.map((item) => item.id));
  const map: Record<string, AskmoreV2DimensionPriority> = {
    ...defaultPriorityMap(params.node),
    ...(params.nodeState.dimension_priority_current ?? {}),
  };

  for (const [dimensionId, priority] of Object.entries(params.candidateMap ?? {})) {
    if (!validIds.has(dimensionId)) continue;
    map[dimensionId] = priority;
  }
  for (const dimensionId of params.candidateMust ?? []) {
    if (!validIds.has(dimensionId)) continue;
    map[dimensionId] = "must";
  }
  for (const dimensionId of params.candidateOptional ?? []) {
    if (!validIds.has(dimensionId)) continue;
    map[dimensionId] = "optional";
  }

  for (const dimension of params.node.target_dimensions) {
    if (!map[dimension.id]) {
      map[dimension.id] = "optional";
    }
  }

  const mustDimensions = params.node.target_dimensions
    .map((item) => item.id)
    .filter((dimensionId) => map[dimensionId] === "must");
  const optionalDimensions = params.node.target_dimensions
    .map((item) => item.id)
    .filter((dimensionId) => map[dimensionId] !== "must");
  return {
    dimension_priority_map: map,
    must_dimensions: mustDimensions,
    optional_dimensions: optionalDimensions,
  };
}

function criterionCovered(params: {
  criterion: string;
  confidenceByDimension: Record<string, number>;
}): boolean {
  const confidence = params.confidenceByDimension[params.criterion];
  return typeof confidence === "number" && confidence >= 0.6;
}

function countCoveredRequired(params: {
  node: AskmoreV2QuestionNode;
  confidenceByDimension: Record<string, number>;
}): number {
  return params.node.completion_criteria.filter((criterion) =>
    criterionCovered({
      criterion,
      confidenceByDimension: params.confidenceByDimension,
    }),
  ).length;
}

function shouldUseHypothesis(params: {
  node: AskmoreV2QuestionNode;
  confidenceByDimension: Record<string, number>;
  contradictionDetected: boolean;
  clarifyCount: number;
}): boolean {
  const targetCount = params.node.target_dimensions.length;
  const covered = params.node.target_dimensions.filter((dimension) => (params.confidenceByDimension[dimension.id] ?? 0) >= 0.6);
  const avgConfidence = covered.length > 0
    ? covered.reduce((sum, dimension) => sum + (params.confidenceByDimension[dimension.id] ?? 0), 0) / covered.length
    : 0;

  let hit = 0;
  if (covered.length >= 2 || (targetCount <= 2 && covered.length >= 1)) hit += 1;
  if (avgConfidence >= 0.7) hit += 1;
  if (!params.contradictionDetected) hit += 1;
  if (params.clarifyCount <= 1) hit += 1;
  return hit >= 2;
}

function fallbackPlan(params: {
  language: AskmoreV2Language;
  currentNode: AskmoreV2QuestionNode;
  nodeState: AskmoreV2NodeRuntimeState;
  extractorResult: AskmoreV2TurnExtractorOutput;
  interviewState: {
    turn_count: number;
    total_questions: number;
    completed_questions: number;
    pending_end_confirmation: boolean;
    progressive_summary_available: boolean;
  };
}): AskmoreV2DialoguePlannerOutput {
  const mergedConfidence = {
    ...params.nodeState.dimension_confidence,
  };
  for (const [dimensionId, fact] of Object.entries(params.extractorResult.facts_extracted)) {
    mergedConfidence[dimensionId] = Math.max(mergedConfidence[dimensionId] ?? 0, fact.confidence);
  }

  const requiredCount = Math.max(1, params.currentNode.completion_criteria.length);
  const coveredCount = countCoveredRequired({
    node: params.currentNode,
    confidenceByDimension: mergedConfidence,
  });
  const nodeReady = coveredCount >= requiredCount;

  const unansweredPriority = (params.extractorResult.unanswered_dimensions ?? []).filter((id) =>
    params.currentNode.target_dimensions.some((dimension) => dimension.id === id),
  );
  const missingPriority = (unansweredPriority.length > 0
    ? unansweredPriority
    : params.extractorResult.missing_dimensions).filter((id) =>
    params.currentNode.target_dimensions.some((dimension) => dimension.id === id),
  );
  const chosen = missingPriority[0] ?? null;

  let action: AskmoreV2DialoguePlannerOutput["planner_action"];
  if (nodeReady) {
    action = "node_wrap_up";
  } else if (params.extractorResult.answer_quality === "off_topic" && params.nodeState.clarify_count >= 1) {
    action = "micro_confirm_then_advance";
  } else if (chosen && params.nodeState.clarify_count < 2) {
    action = "micro_confirm_then_clarify";
  } else {
    action = "micro_confirm_then_advance";
  }

  const interviewCoverage = params.interviewState.total_questions > 0
    ? params.interviewState.completed_questions / params.interviewState.total_questions
    : 0;
  const interviewReadiness = Math.max(
    0,
    Math.min(1, interviewCoverage * 0.8 + (params.interviewState.turn_count >= 3 ? 0.18 : 0)),
  );

  if (action === "node_wrap_up" && params.interviewState.turn_count >= 3 && interviewReadiness >= 0.82) {
    action = "offer_early_summary";
  }

  if (action === "offer_early_summary" && interviewReadiness >= 0.95 && interviewCoverage >= 0.85) {
    action = "end_interview";
  }

  const priority = normalizePriorityOutput({
    node: params.currentNode,
    nodeState: params.nodeState,
  });

  return {
    node_status: nodeReady ? "complete" : coveredCount > 0 ? "partial" : "not_started",
    planner_action: action,
    chosen_dimension_to_ask: action === "micro_confirm_then_clarify" ? chosen : null,
    should_show_micro_confirmation: params.extractorResult.answer_quality !== "off_topic",
    should_use_hypothesis_style: shouldUseHypothesis({
      node: params.currentNode,
      confidenceByDimension: mergedConfidence,
      contradictionDetected: params.extractorResult.contradiction_detected || params.nodeState.contradiction_detected,
      clarifyCount: params.nodeState.clarify_count,
    }),
    should_show_node_summary: action === "node_wrap_up",
    should_offer_early_summary: action === "offer_early_summary",
    progress_signal: {
      covered_count: coveredCount,
      required_count: requiredCount,
      remaining_count: Math.max(0, requiredCount - coveredCount),
    },
    readiness: {
      node_readiness: Math.max(0, Math.min(1, coveredCount / requiredCount)),
      interview_readiness: interviewReadiness,
    },
    planner_notes: {
      reason_short:
        params.language === "zh"
          ? nodeReady
            ? "当前节点信息够用，可收束。"
            : "仍有关键维度缺失，先低摩擦推进。"
          : nodeReady
            ? "Node has enough information to wrap."
            : "Still missing important dimensions, continue with low friction.",
      missing_priority: missingPriority,
    },
    ...priority,
  };
}

export async function planDialogueStep(params: {
  language: AskmoreV2Language;
  currentNode: AskmoreV2QuestionNode;
  nodeState: AskmoreV2NodeRuntimeState;
  extractorResult: AskmoreV2TurnExtractorOutput;
  interviewState: {
    turn_count: number;
    total_questions: number;
    completed_questions: number;
    pending_end_confirmation: boolean;
    progressive_summary_available: boolean;
  };
}): Promise<AskmoreV2DialoguePlannerOutput> {
  try {
    const result = await generateModelObject({
      system: askmoreV2DialoguePlannerPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Current node JSON: ${JSON.stringify(params.currentNode)}`,
        `Node state JSON: ${JSON.stringify(params.nodeState)}`,
        `Extractor result JSON: ${JSON.stringify(params.extractorResult)}`,
        `Interview state JSON: ${JSON.stringify(params.interviewState)}`,
      ].join("\n"),
      schema,
    });

    const priority = normalizePriorityOutput({
      node: params.currentNode,
      nodeState: params.nodeState,
      candidateMap: result.dimension_priority_map,
      candidateMust: result.must_dimensions,
      candidateOptional: result.optional_dimensions,
    });

    return {
      ...result,
      planner_notes: {
        reason_short: result.planner_notes.reason_short,
        missing_priority: result.planner_notes.missing_priority,
      },
      ...priority,
    };
  } catch {
    return fallbackPlan(params);
  }
}
