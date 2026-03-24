import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { publishFlowVersion } from "@/server/askmore_v2/services/builder-service";

const cardSchema = z.object({
  question_id: z.string().min(1),
  original_question: z.string().min(1),
  analysis: z.object({
    evaluation: z.object({
      is_too_broad: z.boolean(),
      is_too_abstract: z.boolean(),
      difficulty: z.enum(["low", "medium", "high"]),
    }),
    reason: z.string().min(1),
  }),
  ai_candidate: z.object({
    entry_question: z.string().min(1),
    sub_questions: z.array(z.string().min(1)).max(4),
    example_answer_styles: z.array(z.string().min(1)).min(1).max(4),
    recommended_strategy: z.string().min(1),
  }),
  selection: z.object({
    mode: z.enum(["use_original", "use_ai_refined", "custom_manual"]),
  }),
  final_payload: z.object({
    entry_question: z.string(),
    sub_questions: z.array(z.string()).max(4),
    example_answer_styles: z.array(z.string()).max(4),
    recommended_strategy: z.string(),
    source_mode: z.enum(["use_original", "use_ai_refined", "custom_manual"]),
  }),
  review_generation_meta: z.object({
    used_fallback: z.boolean(),
  }).optional(),
});

const bodySchema = z.object({
  cards: z.array(cardSchema).min(1),
  raw_questions: z.array(z.string().min(1)).optional(),
  scenario: z.string().optional(),
  target_output_type: z.string().optional(),
  language: z.enum(["en", "zh"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    await ensureAskmoreV2PostgresReady();
    const result = await publishFlowVersion(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
