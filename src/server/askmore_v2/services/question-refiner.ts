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

function buildFallbackReviewItem(params: {
  question: string;
  index: number;
  language: AskmoreV2Language;
}): ReviewItemShape {
  const trimmed = params.question.trim();
  const lower = trimmed.toLowerCase();
  const broadTokens = ["愿景", "strategy", "vision", "future", "长期", "overall", "全面"];
  const abstractTokens = ["价值", "意义", "理念", "belief", "philosophy", "culture"];
  const isTooBroad = trimmed.length > 28 || broadTokens.some((token) => lower.includes(token));
  const isTooAbstract = abstractTokens.some((token) => lower.includes(token));
  const difficulty = isTooBroad || isTooAbstract ? "high" : trimmed.length > 16 ? "medium" : "low";
  const isZh = params.language === "zh";

  return {
    question_id: `q${params.index + 1}`,
    original_question: trimmed,
    evaluation: {
      is_too_broad: isTooBroad,
      is_too_abstract: isTooAbstract,
      difficulty,
    },
    reason: isZh
      ? isTooBroad || isTooAbstract
        ? "问题偏宽或偏抽象，直接回答成本较高。"
        : "问题清晰，可直接进入。"
      : isTooBroad || isTooAbstract
        ? "Question is broad/abstract and hard to answer directly."
        : "Question is clear and answerable directly.",
    recommended_strategy: isTooBroad || isTooAbstract ? "progressive_expand" : "direct_then_clarify",
    entry_question: isZh
      ? `先从最具体的说：关于「${trimmed}」，你现在最确定的一点是什么？`
      : `Let's start concrete: for "${trimmed}", what is one thing you're most sure about right now?`,
    sub_questions: isZh
      ? [
          `你能先用一句话回答「${trimmed}」吗？`,
          "能给一个真实例子吗？",
          "如果只保留一个重点，你会保留什么？",
        ]
      : [
          `Could you answer "${trimmed}" in one sentence first?`,
          "Can you share one concrete example?",
          "If you keep only one key point, what is it?",
        ],
    example_answer_styles: isZh
      ? ["一句话版", "举例版", "业务描述版"]
      : ["one-liner", "example-based", "business-context"],
  };
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
  usedFallback: boolean;
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
        used_fallback: params.usedFallback,
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
      schema,
    });

    const byOriginal = new Map(
      result.review_items.map((item, idx) => [
        item.original_question.trim(),
        {
          ...item,
          question_id: item.question_id || `q${idx + 1}`,
        },
      ]),
    );

    const cards = cleaned.map((question, idx) => {
      const hit = byOriginal.get(question);
      if (hit) {
        return buildCard({
          item: hit,
          index: idx,
          usedFallback: false,
        });
      }
      return buildCard({
        item: buildFallbackReviewItem({
          question,
          index: idx,
          language: params.language,
        }),
        index: idx,
        usedFallback: true,
      });
    });

    return {
      cards,
      review_generation_meta: buildMeta(cards),
    };
  } catch {
    const cards = cleaned.map((question, idx) =>
      buildCard({
        item: buildFallbackReviewItem({
          question,
          index: idx,
          language: params.language,
        }),
        index: idx,
        usedFallback: true,
      }),
    );
    return {
      cards,
      review_generation_meta: buildMeta(cards),
    };
  }
}
