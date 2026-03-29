import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { deleteAskmoreV2SessionInWorkspace } from "@/server/askmore_v2/services/session-service";
import { requireApiAuth } from "@/server/auth/api-auth";

const bodySchema = z.object({
  session_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(request);
    if (unauthorizedResponse || !auth) return unauthorizedResponse!;
    const payload = bodySchema.parse(await request.json());
    await ensureAskmoreV2PostgresReady();
    const deleted = await deleteAskmoreV2SessionInWorkspace({
      sessionId: payload.session_id,
      workspaceId: auth.workspace.id,
    });
    if (!deleted) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
