import { NextRequest, NextResponse } from "next/server";
import { newMessageId, getOrCreateSession } from "@/server/services/session";
import { getInterviewRepository } from "@/server/repo";
import { runAgentTurn } from "@/server/agent/agent-runtime";
import { persistStateAndSession } from "@/server/services/persistence";
import { evaluateCompletion } from "@/server/rules/completion";
import { z } from "zod";

const bodySchema = z.object({
  session_id: z.string().min(1),
  user_message: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    const { stateRecord } = await getOrCreateSession(payload.session_id);
    const repo = getInterviewRepository();

    const userMessage = {
      id: newMessageId(),
      session_id: payload.session_id,
      role: "user" as const,
      content: payload.user_message,
      created_at: new Date().toISOString(),
    };

    await repo.addMessage(userMessage);

    const result = await runAgentTurn({
      sessionId: payload.session_id,
      userMessage: payload.user_message,
      userTurnId: userMessage.id,
      state: stateRecord.state_jsonb,
    });

    const assistantText = result.assistant_message ?? "Could you share a bit more detail?";

    await repo.addMessage({
      id: newMessageId(),
      session_id: payload.session_id,
      role: "assistant",
      content: assistantText,
      created_at: new Date().toISOString(),
    });

    const completion = evaluateCompletion(stateRecord.state_jsonb);

    await persistStateAndSession({
      sessionId: payload.session_id,
      state: stateRecord.state_jsonb,
      completionLevel: completion.completion_level,
      completionScore: completion.completion_score,
      preview: result.updated_preview ?? {},
    });

    return NextResponse.json({
      assistant_message: assistantText,
      interaction_module: result.interaction_module,
      updated_preview: result.updated_preview,
      workflow_state: result.workflow_state,
      planner_task_type: result.planner_task_type,
      model_route_used: result.model_route_used,
      tool_trace: result.tool_trace,
      planner_trace: result.planner_trace,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const detail = error instanceof Error ? error.stack : undefined;
    console.error("[interview/message] Error:", detail ?? message);
    return NextResponse.json(
      { error: message, ...(process.env.NODE_ENV !== "production" && detail ? { stack: detail } : {}) },
      { status: 400 },
    );
  }
}
