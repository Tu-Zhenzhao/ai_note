import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2QuestionRefinerPrompt } from "@/server/askmore_v2/prompts";
import { deriveFinalPayload, normalizeQuestionCard } from "@/server/askmore_v2/flow-definition";
import {
  AskmoreV2Language,
  AskmoreV2QuestionCandidate,
  AskmoreV2QuestionCard,
  AskmoreV2ReviewGenerationMeta,
} from "@/server/askmore_v2/types";

const schema = z.object({
  review_items: z.array(
    z.object({
      question_id: z.string().min(1),
      original_question: z.string().min(1),
      evaluation: z.object({
        is_too_broad: z.boolean(),
        is_too_abstract: z.boolean(),
        difficulty: z.enum(["low", "medium", "high"]),
      }),
      reason: z.string().min(1),
      recommended_strategy: z.string().min(1),
      entry_question: z.string().min(1),
      sub_questions: z.array(z.string().min(1)).max(4).default([]),
      example_answer_styles: z.array(z.string().min(1)).min(1).max(4),
    }),
  ).default([]),
});

type ReviewItemShape = z.infer<typeof schema>["review_items"][number];
const REVIEW_TIMEOUT_MS = Number(process.env.ASKMORE_V2_REVIEW_TIMEOUT_MS ?? 45_000);

function normalizeQuestionKey(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[?.!。？！]+$/g, "")
    .replace(/\s+/g, " ");
}

function pickUnusedIndex(indices: number[] | undefined, used: Set<number>): number | null {
  if (!indices || indices.length === 0) return null;
  for (const index of indices) {
    if (used.has(index)) continue;
    used.add(index);
    return index;
  }
  return null;
}

function toCandidate(item: ReviewItemShape): AskmoreV2QuestionCandidate {
  return {
    entry_question: item.entry_question.trim(),
    sub_questions: item.sub_questions.map((entry) => entry.trim()).filter(Boolean),
    example_answer_styles: item.example_answer_styles.map((entry) => entry.trim()).filter(Boolean),
    recommended_strategy: item.recommended_strategy.trim(),
  };
}

function buildCard(params: {
  item: ReviewItemShape;
  index: number;
}): AskmoreV2QuestionCard {
  const originalQuestion = params.item.original_question.trim();
  const aiCandidate = toCandidate(params.item);
  const finalPayload = deriveFinalPayload({
    originalQuestion,
    aiCandidate,
    selectionMode: "use_ai_refined",
  });

  return normalizeQuestionCard(
    {
      question_id: params.item.question_id || `q${params.index + 1}`,
      original_question: originalQuestion,
      analysis: {
        evaluation: params.item.evaluation,
        reason: params.item.reason,
      },
      ai_candidate: aiCandidate,
      selection: { mode: "use_ai_refined" },
      final_payload: finalPayload,
      review_generation_meta: {
        used_fallback: false,
      },
    },
    params.index,
  );
}

function buildMeta(cards: AskmoreV2QuestionCard[]): AskmoreV2ReviewGenerationMeta {
  const fallbackCount = cards.filter((card) => card.review_generation_meta?.used_fallback).length;
  return {
    used_fallback: fallbackCount > 0,
    fallback_count: fallbackCount,
  };
}

export async function refineQuestionList(params: {
  rawQuestions: string[];
  scenario: string;
  targetOutputType: string;
  language: AskmoreV2Language;
}): Promise<{ cards: AskmoreV2QuestionCard[]; review_generation_meta: AskmoreV2ReviewGenerationMeta }> {
  const cleaned = params.rawQuestions
    .map((question) => question.trim())
    .filter((question) => question.length > 0);

  if (cleaned.length === 0) {
    return {
      cards: [],
      review_generation_meta: {
        used_fallback: false,
        fallback_count: 0,
      },
    };
  }

  try {
    const result = await generateModelObject({
      system: askmoreV2QuestionRefinerPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Scenario: ${params.scenario || "general interview"}`,
        `Target output type: ${params.targetOutputType || "summary report"}`,
        `Raw questions JSON: ${JSON.stringify(cleaned)}`,
      ].join("\n"),
      primaryModel: process.env.ASKMORE_V2_REVIEW_PRIMARY_MODEL ?? "gpt-5",
      fallbackModel: process.env.ASKMORE_V2_REVIEW_FALLBACK_MODEL ?? "deepseek-chat",
      timeoutMs: REVIEW_TIMEOUT_MS,
      schema,
    });

    const reviewItems = result.review_items.map((item, idx) => ({
      ...item,
      question_id: item.question_id || `q${idx + 1}`,
      original_question: item.original_question.trim(),
    }));
    if (reviewItems.length < cleaned.length) {
      throw new Error(`AI review returned ${reviewItems.length} items for ${cleaned.length} questions.`);
    }

    const byExact = new Map<string, number[]>();
    const byNormalized = new Map<string, number[]>();
    for (let i = 0; i < reviewItems.length; i += 1) {
      const original = reviewItems[i].original_question;
      const exactBucket = byExact.get(original) ?? [];
      exactBucket.push(i);
      byExact.set(original, exactBucket);

      const normalized = normalizeQuestionKey(original);
      const normalizedBucket = byNormalized.get(normalized) ?? [];
      normalizedBucket.push(i);
      byNormalized.set(normalized, normalizedBucket);
    }

    const usedIndices = new Set<number>();
    const cards = cleaned.map((question, idx) => {
      let chosen = pickUnusedIndex(byExact.get(question), usedIndices);
      if (chosen === null) {
        const normalized = normalizeQuestionKey(question);
        chosen = pickUnusedIndex(byNormalized.get(normalized), usedIndices);
      }
      if (chosen === null && idx < reviewItems.length && !usedIndices.has(idx)) {
        usedIndices.add(idx);
        chosen = idx;
      }
      if (chosen === null) {
        chosen = pickUnusedIndex(reviewItems.map((_, index) => index), usedIndices);
      }
      if (chosen === null) {
        throw new Error("AI review output could not be aligned to input questions.");
      }

      const aligned: ReviewItemShape = {
        ...reviewItems[chosen],
        // Preserve Builder input as source of truth to avoid downstream mismatch.
        original_question: question,
        question_id: `q${idx + 1}`,
      };

      return buildCard({
        item: aligned,
        index: idx,
      });
    });

    return {
      cards,
      review_generation_meta: buildMeta(cards),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    throw new Error(`AI review failed without fallback. ${message}`);
  }
}
