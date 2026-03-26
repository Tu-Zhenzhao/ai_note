import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { SessionRuntimeManager } from "@/server/askmore_v2/runtime/session-runtime-manager";
import type { AskmoreV2TurnStreamEvent } from "@/server/askmore_v2/types";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  user_message: z.string().min(1),
  client_turn_id: z.string().uuid(),
  language: z.enum(["en", "zh"]).optional().default("zh"),
  choice: z.object({
    dimension_id: z.string().min(1),
    option_id: z.string().min(1),
    option_label: z.string().min(1),
    choice_kind: z.enum(["micro_confirm", "follow_up_select"]).optional(),
    source_event_id: z.string().min(1).optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    const streamMode = request.nextUrl.searchParams.get("stream") === "1";
    await ensureAskmoreV2PostgresReady();
    if (streamMode) {
      return streamTurnResponse(payload);
    }
    const result = await runTurn(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function runTurn(payload: z.infer<typeof bodySchema>) {
  const runtimeManager = new SessionRuntimeManager();
  return runtimeManager.enqueueTurn({
    sessionId: payload.session_id,
    userMessage: payload.user_message,
    language: payload.language,
    clientTurnId: payload.client_turn_id,
    choice: payload.choice,
  });
}

function streamTurnResponse(payload: z.infer<typeof bodySchema>) {
  const encoder = new TextEncoder();
  const write = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: AskmoreV2TurnStreamEvent,
  ) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  };

  const runtimeManager = new SessionRuntimeManager();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          const result = await runtimeManager.enqueueTurn({
            sessionId: payload.session_id,
            userMessage: payload.user_message,
            language: payload.language,
            clientTurnId: payload.client_turn_id,
            choice: payload.choice,
            onPhaseProgress: (event) => {
              write(controller, {
                type: "phase",
                phase: event.phase,
                status: event.status,
                label: event.label,
              });
            },
          });

          write(controller, {
            type: "final",
            payload: result,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          write(controller, {
            type: "error",
            error: message,
            code: "ASKMORE_V2_TURN_STREAM_FAILED",
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
