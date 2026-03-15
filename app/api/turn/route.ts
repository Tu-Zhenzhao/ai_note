import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSuperV1TurnController } from "@/server/superv1/turn-controller";
import { ensureSuperV1PostgresReady } from "@/server/superv1/db-preflight";
import { normalizeSuperV1Error } from "@/server/superv1/runtime-errors";
import { traceRunEnd, traceRunStart } from "@/server/tools/runtime-trace";
import { SuperV1RuntimePhase } from "@/server/superv1/types";
import { getContextWindowInfo, getLastTokenUsage } from "@/server/model/adapters";
import {
  getConversationCumulativeTokens,
  persistTurnUsageEvent,
} from "@/server/superv1/services/usage-log-service";

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
    const streamMode = request.nextUrl.searchParams.get("stream") === "1";
    traceCtx = {
      runtime: "route.superv1.turn",
      conversationId: payload.conversationId,
    };
    traceRunStart(traceCtx, {
      language: payload.language,
      message_len: payload.userMessage.length,
    });

    await ensureSuperV1PostgresReady();
    if (streamMode) {
      return streamTurnResponse({
        payload,
        startedAt,
        traceCtx,
      });
    }
    const result = await getSuperV1TurnController().handleUserTurn(payload);
    const contextWindow = getContextWindowInfo();
    const turnUsage = getLastTokenUsage();
    await persistTurnUsageEvent({
      conversationId: payload.conversationId,
      contextWindow,
      turnUsage,
    });
    const cumulativeTokens = await getConversationCumulativeTokens(payload.conversationId);
    traceRunEnd(traceCtx, {
      status: "ok",
      durationMs: Date.now() - startedAt,
      summary: {
        message_len: payload.userMessage.length,
        active_section: result.planner_result.active_section_id,
        intent: result.intent.intent,
        mode_before: result.interaction.mode_before,
        mode_after: result.interaction.mode_after,
        help_transition: result.interaction.help_transition,
        accepted_updates_count: null,
        rejected_updates_count: null,
        ambiguous_count: null,
        next_question_id: result.next_question.question_id,
        reply_len: result.reply.length,
        duration_ms: Date.now() - startedAt,
      },
    });
    return NextResponse.json({
      ...result,
      context_window: contextWindow,
      cumulative_tokens: cumulativeTokens,
    });
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

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function replyChunks(text: string): string[] {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const next = Math.min(text.length, cursor + 22);
    chunks.push(text.slice(cursor, next));
    cursor = next;
  }
  return chunks.length > 0 ? chunks : [""];
}

function streamTurnResponse(params: {
  payload: z.infer<typeof bodySchema>;
  startedAt: number;
  traceCtx: { runtime: string; conversationId?: string };
}) {
  const encoder = new TextEncoder();
  const write = (controller: ReadableStreamDefaultController<Uint8Array>, value: unknown) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const sentDone = new Set<SuperV1RuntimePhase>();
        try {
          write(controller, {
            type: "phase",
            phase: "intent_classification",
            status: "start",
          });
          const result = await getSuperV1TurnController().handleUserTurn({
            ...params.payload,
            onPhaseProgress: (event) => {
              if (event.status === "done") {
                sentDone.add(event.phase);
              }
              write(controller, {
                type: "phase",
                phase: event.phase,
                status: event.status,
              });
            },
          });
          const contextWindow = getContextWindowInfo();
          const turnUsage = getLastTokenUsage();
          await persistTurnUsageEvent({
            conversationId: params.payload.conversationId,
            contextWindow,
            turnUsage,
          });
          const cumulativeTokens = await getConversationCumulativeTokens(params.payload.conversationId);

          write(controller, { type: "pipeline_done" });
          await sleep(760);

          for (const chunk of replyChunks(result.reply)) {
            write(controller, { type: "reply_chunk", chunk });
            await sleep(22);
          }

          write(controller, {
            type: "final",
            payload: {
              ...result,
              context_window: contextWindow,
              cumulative_tokens: cumulativeTokens,
            },
          });
          traceRunEnd(params.traceCtx, {
            status: "ok",
            durationMs: Date.now() - params.startedAt,
            summary: {
              message_len: params.payload.userMessage.length,
              active_section: result.planner_result.active_section_id,
              intent: result.intent.intent,
              mode_before: result.interaction.mode_before,
              mode_after: result.interaction.mode_after,
              help_transition: result.interaction.help_transition,
              accepted_updates_count: null,
              rejected_updates_count: null,
              ambiguous_count: null,
              next_question_id: result.next_question.question_id,
              reply_len: result.reply.length,
              duration_ms: Date.now() - params.startedAt,
              streamed: true,
              streamed_phases_done: Array.from(sentDone),
            },
          });
        } catch (error) {
          const normalized = normalizeSuperV1Error(error);
          write(controller, {
            type: "error",
            error: normalized.message,
            code: normalized.code,
            ...(normalized.details ? { details: normalized.details } : {}),
          });
          traceRunEnd(params.traceCtx, {
            status: "fail",
            durationMs: Date.now() - params.startedAt,
            summary: {
              route: "/api/turn",
              code: normalized.code,
              error_message: normalized.message,
              ...(normalized.details ?? {}),
              streamed: true,
            },
          });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
