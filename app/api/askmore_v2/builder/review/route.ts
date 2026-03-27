import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { reviewRawQuestions } from "@/server/askmore_v2/services/builder-service";

const bodySchema = z.object({
  raw_questions: z.array(z.string().min(1)).min(1),
  scenario: z.string().default("general interview"),
  target_output_type: z.string().default("summary report"),
  language: z.enum(["en", "zh"]).optional().default("zh"),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    await ensureAskmoreV2PostgresReady();
    const result = await reviewRawQuestions(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const isAiReviewFailure = message.startsWith("AI review failed without fallback.");
    const isDbUnavailable =
      /database_url|postgres|schema is missing|connection timeout|timeout expired|could not connect|connection terminated/i.test(
        message.toLowerCase(),
      );
    return NextResponse.json(
      {
        error: message,
        code: isAiReviewFailure ? "AI_REVIEW_UPSTREAM_FAILED" : isDbUnavailable ? "DB_UNAVAILABLE" : "BAD_REQUEST",
      },
      { status: isAiReviewFailure ? 502 : isDbUnavailable ? 503 : 400 },
    );
  }
}
