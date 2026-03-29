import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { getAskmoreV2SessionDetailInWorkspace } from "@/server/askmore_v2/services/session-service";
import { requireApiAuth } from "@/server/auth/api-auth";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(_request);
    if (unauthorizedResponse || !auth) return unauthorizedResponse!;
    const params = paramsSchema.parse(await context.params);
    await ensureAskmoreV2PostgresReady();
    const detail = await getAskmoreV2SessionDetailInWorkspace({
      sessionId: params.id,
      workspaceId: auth.workspace.id,
    });
    if (!detail.session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
