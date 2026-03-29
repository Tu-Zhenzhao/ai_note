import { NextRequest, NextResponse } from "next/server";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { getActiveFlowVersion } from "@/server/askmore_v2/services/builder-service";
import { requireApiAuth } from "@/server/auth/api-auth";

export async function GET(request: NextRequest) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(request);
    if (unauthorizedResponse || !auth) return unauthorizedResponse!;
    await ensureAskmoreV2PostgresReady();
    const flow = await getActiveFlowVersion(auth.workspace.id);
    if (!flow) {
      return NextResponse.json({ flow: null });
    }
    return NextResponse.json({ flow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
