import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { handleAskmoreV2Turn } from "@/server/askmore_v2/services/interview-runtime";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  user_message: z.string().min(1),
  language: z.enum(["en", "zh"]).optional().default("zh"),
  choice: z.object({
    dimension_id: z.string().min(1),
    option_id: z.string().min(1),
    option_label: z.string().min(1),
  }).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    await ensureAskmoreV2PostgresReady();
    const result = await handleAskmoreV2Turn({
      sessionId: payload.session_id,
      userMessage: payload.user_message,
      language: payload.language,
      choice: payload.choice,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
