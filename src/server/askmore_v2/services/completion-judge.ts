import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2CompletionJudgePrompt } from "@/server/askmore_v2/prompts";
import { AskmoreV2Language, AskmoreV2Readiness } from "@/server/askmore_v2/types";

const schema = z.object({
  readiness_score: z.number().min(0).max(1),
  can_generate_summary: z.boolean(),
  should_end_early: z.boolean(),
  reason: z.string().min(1),
});

export async function judgeCompletion(params: {
  language: AskmoreV2Language;
  turnCount: number;
  answeredQuestionCount: number;
  totalQuestionCount: number;
  missingPoints: string[];
  structuredKnowledge: Record<string, unknown>;
}): Promise<AskmoreV2Readiness> {
  const coverage = params.totalQuestionCount > 0
    ? params.answeredQuestionCount / params.totalQuestionCount
    : 0;

  try {
    const result = await generateModelObject({
      system: askmoreV2CompletionJudgePrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Turn count: ${params.turnCount}`,
        `Answered question count: ${params.answeredQuestionCount}`,
        `Total question count: ${params.totalQuestionCount}`,
        `Coverage ratio: ${coverage.toFixed(2)}`,
        `Missing points: ${params.missingPoints.join(" | ") || "none"}`,
        `Structured knowledge JSON: ${JSON.stringify(params.structuredKnowledge)}`,
      ].join("\n"),
      schema,
    });
    return result;
  } catch {
    const readinessScore = Math.max(0, Math.min(1, coverage * 0.75 + (params.turnCount >= 3 ? 0.15 : 0)));
    return {
      readiness_score: readinessScore,
      can_generate_summary: params.turnCount >= 3,
      should_end_early: params.turnCount >= 3 && readinessScore >= 0.7,
      reason: params.language === "zh"
        ? params.missingPoints.length > 0
          ? "已覆盖部分关键信息，但仍有缺口。"
          : "关键信息覆盖较好，可以考虑先看总结。"
        : params.missingPoints.length > 0
          ? "Key information is partially covered, but there are still gaps."
          : "Coverage is decent and a draft summary can be shown.",
    };
  }
}
