import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { listAskmoreV2SessionsInWorkspace } from "@/server/askmore_v2/services/session-service";
import { requireApiAuth } from "@/server/auth/api-auth";

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
});

export async function GET(request: NextRequest) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(request);
    if (unauthorizedResponse || !auth) return unauthorizedResponse!;
    const url = new URL(request.url);
    const payload = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    await ensureAskmoreV2PostgresReady();
    const sessions = await listAskmoreV2SessionsInWorkspace(auth.workspace.id, payload.limit);
    return NextResponse.json({ sessions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
