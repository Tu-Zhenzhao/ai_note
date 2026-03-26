import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2UnderstandingSummaryPrompt } from "@/server/askmore_v2/prompts";
import { AskmoreV2Language, AskmoreV2QuestionNode, AskmoreV2TurnExtractorOutput } from "@/server/askmore_v2/types";

function dimLabel(node: AskmoreV2QuestionNode, dimensionId: string): string {
  return node.target_dimensions.find((item) => item.id === dimensionId)?.label ?? dimensionId;
}

const summarySchema = z.object({
  summary: z.string().min(1).max(360),
});

function normalizeOutput(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimValue(value: string, max = 42): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function compactMessages(messages: Array<{ role: "user" | "assistant"; message: string }>): string[] {
  return messages
    .slice(-4)
    .map((item) => `${item.role}: ${trimValue(item.message, 72)}`);
}

function fallbackSummary(params: {
  language: AskmoreV2Language;
  node: AskmoreV2QuestionNode;
  extractor: AskmoreV2TurnExtractorOutput;
  fallback: string;
  recentTurns?: string[];
  knownFacts?: Array<{ label: string; value: string }>;
  missingHints?: string[];
}): string {
  const trimmed = params.fallback.trim();
  const updates = Object.keys(params.extractor.facts_extracted).slice(0, 3);
  if (updates.length === 0) {
    const questionLike = /[?？]$/.test(trimmed) || /(怎么|什么意思|是.+还是|why|what|how)/i.test(trimmed);
    return params.language === "zh"
      ? questionLike
        ? "我收到你的确认问题了，我们先把口径对齐再继续。"
        : "收到你的补充，我会基于这条信息继续判断。"
      : questionLike
        ? "I got your clarification question. I will align the meaning first, then continue."
        : "Got your update. I will use this input to continue the assessment.";
  }

  const newFacts = updates.map((dimensionId) => {
    const label = dimLabel(params.node, dimensionId);
    const value = params.extractor.facts_extracted[dimensionId]?.value?.trim() ?? "";
    return value ? `${label}=${trimValue(value)}` : label;
  });
  const prior = (params.knownFacts ?? []).find((item) => {
    const value = item.value?.trim() ?? "";
    if (!value) return false;
    return !newFacts.some((entry) => entry.includes(item.label));
  });
  const missingHint = (params.missingHints ?? [])[0] ?? "";

  if (params.language === "zh") {
    if (prior && missingHint) {
      return `明白了，你这次补充了${newFacts.join("；")}。结合前面提到的${prior.label}，我们现在的判断链路更完整，接下来就能更稳地补齐${missingHint}。`;
    }
    if (prior) {
      return `明白了，你这次补充了${newFacts.join("；")}。这和你前面提到的${prior.label}能对上，整体判断更清楚了。`;
    }
    return `明白了，你这次补充了${newFacts.join("；")}。这让我们对当前问题的判断更完整了。`;
  }
  if (prior && missingHint) {
    return `Got it. You added ${newFacts.join("; ")}. Combined with your earlier note on ${prior.label}, this gives us a clearer path to close ${missingHint}.`;
  }
  if (prior) {
    return `Got it. You added ${newFacts.join("; ")}. This aligns with your earlier note on ${prior.label}, so the picture is now clearer.`;
  }
  return `Got it. You added ${newFacts.join("; ")}, which makes the current assessment more complete.`;
}

export async function generateUnderstandingSummary(params: {
  language: AskmoreV2Language;
  node: AskmoreV2QuestionNode;
  extractor: AskmoreV2TurnExtractorOutput;
  fallback: string;
  recentTurns?: string[];
  recentMessages?: Array<{ role: "user" | "assistant"; message: string }>;
  knownFacts?: Array<{ label: string; value: string }>;
  missingHints?: string[];
}): Promise<string> {
  const extractedFacts = Object.entries(params.extractor.facts_extracted).map(([dimensionId, fact]) => ({
    dimension_id: dimensionId,
    label: dimLabel(params.node, dimensionId),
    value: trimValue(fact.value, 64),
    confidence: fact.confidence,
  }));
  const knownFacts = (params.knownFacts ?? [])
    .map((item) => ({
      label: item.label,
      value: trimValue(item.value, 64),
    }))
    .slice(0, 5);
  const recentTurns = (params.recentTurns ?? []).map((item) => trimValue(item, 72)).slice(-4);
  const recentMessages = compactMessages(params.recentMessages ?? []);
  const missingHints = (params.missingHints ?? []).slice(0, 3);

  try {
    const result = await generateModelObject({
      system: askmoreV2UnderstandingSummaryPrompt(),
      prompt: [
        `language: ${params.language}`,
        `active_question: ${params.node.user_facing_entry}`,
        `latest_user_turn: ${params.fallback}`,
        `extracted_facts: ${JSON.stringify(extractedFacts)}`,
        `known_facts: ${JSON.stringify(knownFacts)}`,
        `recent_turns: ${JSON.stringify(recentTurns)}`,
        `recent_messages: ${JSON.stringify(recentMessages)}`,
        `missing_hints: ${JSON.stringify(missingHints)}`,
      ].join("\n"),
      schema: summarySchema,
    });
    return normalizeOutput(result.summary);
  } catch {
    return fallbackSummary(params);
  }
}

export function generateCoverageSummary(params: {
  language: AskmoreV2Language;
  covered: number;
  required: number;
}): string {
  if (params.language === "zh") {
    return `当前关键覆盖：${params.covered}/${params.required}。`;
  }
  return `Current required coverage: ${params.covered}/${params.required}.`;
}
