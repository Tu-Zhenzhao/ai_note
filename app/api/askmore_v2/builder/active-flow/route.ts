import { NextResponse } from "next/server";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { getActiveFlowVersion } from "@/server/askmore_v2/services/builder-service";

export async function GET() {
  try {
    await ensureAskmoreV2PostgresReady();
    const flow = await getActiveFlowVersion();
    if (!flow) {
      return NextResponse.json({ flow: null });
    }
    return NextResponse.json({ flow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
