import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2TurnExtractorPrompt } from "@/server/askmore_v2/prompts";
import {
  AskmoreV2Language,
  AskmoreV2NodeRuntimeState,
  AskmoreV2QuestionNode,
  AskmoreV2TurnExtractorOutput,
} from "@/server/askmore_v2/types";
import { normalizeDimensionKey } from "@/server/askmore_v2/services/dimension-intelligence";

const schema = z.object({
  facts_extracted: z.record(
    z.string(),
    z.object({
      value: z.string().min(1),
      evidence: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ).default({}),
  updated_dimensions: z.array(z.string().min(1)).default([]),
  missing_dimensions: z.array(z.string().min(1)).default([]),
  answer_quality: z.enum(["clear", "usable", "vague", "off_topic"]),
  user_effort_signal: z.enum(["low", "normal", "high"]),
  contradiction_detected: z.boolean(),
  candidate_hypothesis: z.string().min(1),
  confidence_overall: z.number().min(0).max(1),
});

function classifyAnswerQuality(text: string): AskmoreV2TurnExtractorOutput["answer_quality"] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "off_topic";
  if (/^[?？]+$/.test(trimmed)) return "off_topic";
  if (trimmed.length < 8) return "vague";
  if (trimmed.length < 24) return "usable";
  return "clear";
}

function classifyEffortSignal(text: string): AskmoreV2TurnExtractorOutput["user_effort_signal"] {
  const length = text.trim().length;
  if (length < 8) return "low";
  if (length > 60) return "high";
  return "normal";
}

function computeMissingDimensions(params: {
  currentNode: AskmoreV2QuestionNode;
  nodeState: AskmoreV2NodeRuntimeState;
  factsExtracted: AskmoreV2TurnExtractorOutput["facts_extracted"];
}): string[] {
  const ids = params.currentNode.target_dimensions.map((item) => item.id);
  const missing: string[] = [];

  for (const id of ids) {
    const existing = Number(params.nodeState.dimension_confidence[id] ?? 0);
    const incoming = Number(params.factsExtracted[id]?.confidence ?? 0);
    if (Math.max(existing, incoming) < 0.6) {
      missing.push(id);
    }
  }

  return missing;
}

function toAllowedFacts(params: {
  currentNode: AskmoreV2QuestionNode;
  rawFacts: Record<string, { value: string; evidence: string; confidence: number }>;
}): {
  facts: AskmoreV2TurnExtractorOutput["facts_extracted"];
  normalizedMap: Record<string, string>;
  normalizationHits: string[];
} {
  const next: AskmoreV2TurnExtractorOutput["facts_extracted"] = {};
  const normalizedMap: Record<string, string> = {};
  const normalizationHits: string[] = [];

  for (const [key, value] of Object.entries(params.rawFacts)) {
    const normalizedKey = normalizeDimensionKey({
      rawKey: key,
      currentNode: params.currentNode,
    });
    if (!normalizedKey) continue;

    normalizedMap[key] = normalizedKey;
    if (normalizedKey !== key) normalizationHits.push(key);

    const val = typeof value.value === "string" ? value.value.trim() : "";
    const evidence = typeof value.evidence === "string" ? value.evidence.trim() : "";
    if (!val || !evidence) continue;
    const existing = next[normalizedKey];
    const confidence = Math.max(0, Math.min(1, Number(value.confidence ?? 0)));
    if (existing && existing.confidence >= confidence) continue;

    next[normalizedKey] = {
      value: val,
      evidence,
      confidence,
    };
  }

  return {
    facts: next,
    normalizedMap,
    normalizationHits,
  };
}

function buildFallback(params: {
  language: AskmoreV2Language;
  currentNode: AskmoreV2QuestionNode;
  nodeState: AskmoreV2NodeRuntimeState;
  userMessage: string;
}): AskmoreV2TurnExtractorOutput {
  const quality = classifyAnswerQuality(params.userMessage);
  const effort = classifyEffortSignal(params.userMessage);

  const firstMissing = params.currentNode.target_dimensions.find(
    (item) => Number(params.nodeState.dimension_confidence[item.id] ?? 0) < 0.6,
  );

  const facts: AskmoreV2TurnExtractorOutput["facts_extracted"] =
    firstMissing && quality !== "off_topic"
      ? {
          [firstMissing.id]: {
            value: params.userMessage.trim(),
            evidence: params.userMessage.trim().slice(0, 120),
            confidence: quality === "clear" ? 0.78 : quality === "usable" ? 0.64 : 0.42,
          },
        }
      : {};

  const updatedDimensions = Object.keys(facts);
  const missing = computeMissingDimensions({
    currentNode: params.currentNode,
    nodeState: params.nodeState,
    factsExtracted: facts,
  });

  const coveredCount = params.currentNode.target_dimensions.length - missing.length;
  const confidenceOverall = params.currentNode.target_dimensions.length > 0
    ? Math.max(0, Math.min(1, coveredCount / params.currentNode.target_dimensions.length))
    : 0;

  return {
    facts_extracted: facts,
    updated_dimensions: updatedDimensions,
    missing_dimensions: missing,
    unanswered_dimensions: missing,
    answer_quality: quality,
    user_effort_signal: effort,
    contradiction_detected: false,
    candidate_hypothesis:
      params.language === "zh"
        ? missing.length === 0
          ? "关键信息基本齐全"
          : "已抓到部分事实，仍需补充"
        : missing.length === 0
          ? "key facts are mostly covered"
          : "partial facts captured, still missing details",
    confidence_overall: confidenceOverall,
    normalized_dimension_map: {},
    normalization_hits: [],
  };
}

export async function extractTurnFacts(params: {
  language: AskmoreV2Language;
  currentNode: AskmoreV2QuestionNode;
  nodeState: AskmoreV2NodeRuntimeState;
  userMessage: string;
}): Promise<AskmoreV2TurnExtractorOutput> {
  try {
    const result = await generateModelObject({
      system: askmoreV2TurnExtractorPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Current node JSON: ${JSON.stringify(params.currentNode)}`,
        `Node state JSON: ${JSON.stringify(params.nodeState)}`,
        `User message: ${params.userMessage}`,
      ].join("\n"),
      schema,
    });

    const normalized = toAllowedFacts({
      currentNode: params.currentNode,
      rawFacts: result.facts_extracted,
    });
    const facts = normalized.facts;
    const missing = computeMissingDimensions({
      currentNode: params.currentNode,
      nodeState: params.nodeState,
      factsExtracted: facts,
    });

    return {
      facts_extracted: facts,
      updated_dimensions: result.updated_dimensions.filter((id) => Boolean(facts[id])),
      missing_dimensions: missing,
      unanswered_dimensions: missing,
      answer_quality: result.answer_quality,
      user_effort_signal: result.user_effort_signal,
      contradiction_detected: result.contradiction_detected,
      candidate_hypothesis: result.candidate_hypothesis,
      confidence_overall: Math.max(0, Math.min(1, result.confidence_overall)),
      normalized_dimension_map: normalized.normalizedMap,
      normalization_hits: normalized.normalizationHits,
    };
  } catch {
    return buildFallback(params);
  }
}
