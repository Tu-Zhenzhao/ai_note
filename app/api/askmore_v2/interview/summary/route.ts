import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { generateAskmoreV2Summary } from "@/server/askmore_v2/services/interview-runtime";
import { requireApiAuth } from "@/server/auth/api-auth";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  mode: z.enum(["progressive", "final"]).default("progressive"),
  language: z.enum(["en", "zh"]).optional().default("zh"),
});

export async function POST(request: NextRequest) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(request);
    if (unauthorizedResponse || !auth) return unauthorizedResponse!;
    const payload = bodySchema.parse(await request.json());
    await ensureAskmoreV2PostgresReady();
    const result = await generateAskmoreV2Summary({
      sessionId: payload.session_id,
      language: payload.language,
      mode: payload.mode,
      workspace_id: auth.workspace.id,
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
