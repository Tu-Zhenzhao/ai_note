import { NextResponse } from "next/server";
import { ensureSuperV1PostgresReady } from "@/server/superv1/db-preflight";
import { normalizeSuperV1Error } from "@/server/superv1/runtime-errors";
import { listSuperV1Conversations } from "@/server/superv1/services/conversation-service";
import { traceRunEnd, traceRunStart } from "@/server/tools/runtime-trace";

export async function GET() {
  const startedAt = Date.now();
  const traceCtx = { runtime: "route.superv1.conversations.list" } as const;
  try {
    traceRunStart(traceCtx);
    await ensureSuperV1PostgresReady();
    const conversations = await listSuperV1Conversations(100);
    traceRunEnd(traceCtx, {
      status: "ok",
      durationMs: Date.now() - startedAt,
      summary: {
        count: conversations.length,
        duration_ms: Date.now() - startedAt,
      },
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    const normalized = normalizeSuperV1Error(error);
    traceRunEnd(traceCtx, {
      status: "fail",
      durationMs: Date.now() - startedAt,
      summary: {
        code: normalized.code,
        error_message: normalized.message,
      },
    });
    return NextResponse.json(
      {
        error: normalized.message,
        code: normalized.code,
        ...(normalized.details ? { details: normalized.details } : {}),
      },
      { status: normalized.status },
    );
  }
}
