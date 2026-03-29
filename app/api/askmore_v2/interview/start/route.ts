import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { startAskmoreV2Interview } from "@/server/askmore_v2/services/interview-runtime";
import { requireApiAuth } from "@/server/auth/api-auth";

const bodySchema = z.object({
  language: z.enum(["en", "zh"]).optional().default("zh"),
});

export async function POST(request: NextRequest) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(request);
    if (unauthorizedResponse || !auth) return unauthorizedResponse!;
    const payload = bodySchema.parse(await request.json().catch(() => ({})));
    await ensureAskmoreV2PostgresReady();
    const result = await startAskmoreV2Interview({
      language: payload.language,
      workspace_id: auth.workspace.id,
      created_by_user_id: auth.user.id,
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
