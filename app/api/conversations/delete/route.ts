import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSuperV1PostgresReady } from "@/server/superv1/db-preflight";
import { normalizeSuperV1Error } from "@/server/superv1/runtime-errors";
import { deleteSuperV1Conversation } from "@/server/superv1/services/conversation-service";
import { traceRunEnd, traceRunStart } from "@/server/tools/runtime-trace";

const bodySchema = z.object({
  conversationId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let traceCtx: { runtime: string; conversationId?: string } = {
    runtime: "route.superv1.conversations.delete",
  };
  try {
    const payload = bodySchema.parse(await request.json());
    traceCtx = {
      runtime: "route.superv1.conversations.delete",
      conversationId: payload.conversationId,
    };
    traceRunStart(traceCtx);
    await ensureSuperV1PostgresReady();
    await deleteSuperV1Conversation(payload.conversationId);
    traceRunEnd(traceCtx, {
      status: "ok",
      durationMs: Date.now() - startedAt,
      summary: {
        deleted: true,
        duration_ms: Date.now() - startedAt,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.issues[0]?.message ?? "Invalid request payload";
      traceRunEnd(traceCtx, {
        status: "fail",
        durationMs: Date.now() - startedAt,
        summary: {
          code: "SUPERV1_BAD_REQUEST",
          error_message: message,
        },
      });
      return NextResponse.json({ error: message, code: "SUPERV1_BAD_REQUEST" }, { status: 400 });
    }
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
