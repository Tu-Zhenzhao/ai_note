import { NextResponse } from "next/server";
import { startSuperV1Conversation } from "@/server/superv1/services/conversation-service";
import { ensureSuperV1PostgresReady } from "@/server/superv1/db-preflight";
import { normalizeSuperV1Error } from "@/server/superv1/runtime-errors";
import { traceRunEnd, traceRunStart } from "@/server/tools/runtime-trace";

export async function POST() {
  const startedAt = Date.now();
  const traceCtx = { runtime: "route.superv1.start" } as const;
  try {
    traceRunStart(traceCtx);
    await ensureSuperV1PostgresReady();
    const started = await startSuperV1Conversation();
    traceRunEnd(traceCtx, {
      status: "ok",
      durationMs: Date.now() - startedAt,
      summary: {
        conversation_id: started.conversationId,
        status: started.state.status,
        active_section: started.state.activeSectionId,
        duration_ms: Date.now() - startedAt,
      },
    });
    return NextResponse.json({
      conversationId: started.conversationId,
      state: started.state,
    });
  } catch (error) {
    const normalized = normalizeSuperV1Error(error);
    traceRunEnd(traceCtx, {
      status: "fail",
      durationMs: Date.now() - startedAt,
      summary: {
        code: normalized.code,
        error_message: normalized.message,
        duration_ms: Date.now() - startedAt,
        ...(normalized.details ?? {}),
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
