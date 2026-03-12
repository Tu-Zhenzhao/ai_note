import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSuperV1TurnController } from "@/server/superv1/turn-controller";
import { ensureSuperV1PostgresReady } from "@/server/superv1/db-preflight";
import { normalizeSuperV1Error } from "@/server/superv1/runtime-errors";
import { traceRunEnd, traceRunStart } from "@/server/tools/runtime-trace";

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  userMessage: z.string().min(1),
  language: z.enum(["en", "zh"]).optional().default("en"),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let traceCtx: { runtime: string; conversationId?: string } = {
    runtime: "route.superv1.turn",
  };
  try {
    const payload = bodySchema.parse(await request.json());
    traceCtx = {
      runtime: "route.superv1.turn",
      conversationId: payload.conversationId,
    };
    traceRunStart(traceCtx, {
      language: payload.language,
      message_len: payload.userMessage.length,
    });

    await ensureSuperV1PostgresReady();
    const result = await getSuperV1TurnController().handleUserTurn({
      conversationId: payload.conversationId,
      userMessage: payload.userMessage,
      language: payload.language,
    });
    traceRunEnd(traceCtx, {
      status: "ok",
      durationMs: Date.now() - startedAt,
      summary: {
        message_len: payload.userMessage.length,
        active_section: result.planner_result.active_section_id,
        intent: result.intent.intent,
        accepted_updates_count: null,
        rejected_updates_count: null,
        ambiguous_count: null,
        next_question_id: result.next_question.question_id,
        reply_len: result.reply.length,
        duration_ms: Date.now() - startedAt,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.issues[0]?.message ?? "Invalid request payload";
      traceRunEnd(traceCtx, {
        status: "fail",
        durationMs: Date.now() - startedAt,
        summary: {
          route: "/api/turn",
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
        route: "/api/turn",
        code: normalized.code,
        error_message: normalized.message,
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
