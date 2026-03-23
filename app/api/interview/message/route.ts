import { NextRequest, NextResponse } from "next/server";
import { newMessageId, getOrCreateSession } from "@/server/services/session";
import { getInterviewRepository } from "@/server/repo";
import { persistStateAndSession } from "@/server/services/persistence";
import { evaluateCompletion } from "@/server/rules/completion";
import { getContextWindowInfo, getCumulativeTokenUsage } from "@/server/model/adapters";
import { getCurrentSectionName } from "@/server/rules/checklist";
import { getTurnController } from "@/server/turn-controller";
import { traceRunEnd, traceRunStart, toErrorSummary } from "@/server/tools/runtime-trace";
import { z } from "zod";

const bodySchema = z.object({
  session_id: z.string().min(1),
  user_message: z.string().min(1),
  language: z.enum(["en", "zh"]).optional().default("zh"),
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let traceCtx: { runtime: string; sessionId?: string; turnId?: string } = {
    runtime: "route.interview.message",
  };
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
    traceCtx = {
      runtime: "route.interview.message",
      sessionId: payload.session_id,
      turnId: userMessage.id,
    };
    traceRunStart(traceCtx, {
      language: payload.language,
      message_len: payload.user_message.length,
      workflow_phase: stateRecord.state_jsonb.workflow.phase,
      active_section: stateRecord.state_jsonb.workflow.active_section_id,
    });

    const workflowBefore = { ...stateRecord.state_jsonb.workflow };
    const sectionIndexBefore = stateRecord.state_jsonb.conversation_meta.current_section_index;

    await repo.addMessage(userMessage);

    const result = await getTurnController().handleUserTurn({
      sessionId: payload.session_id,
      userMessage: payload.user_message,
      userTurnId: userMessage.id,
      state: stateRecord.state_jsonb,
      language: payload.language,
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
    const workflowAfter = { ...stateRecord.state_jsonb.workflow };
    const sectionIndexAfter = stateRecord.state_jsonb.conversation_meta.current_section_index;
    const diagnostics = stateRecord.state_jsonb.system_assessment.last_turn_diagnostics;
    const extractionRan = result.tool_trace.some(
      (entry) => entry.tool_name === "answer_turn_controller",
    );
    const confirmInteractionOpened = result.tool_trace.some(
      (entry) => entry.tool_name === "interaction_confirm_section",
    );
    const responseGuardrailApplied = (diagnostics?.tool_actions_used ?? []).includes(
      "assistant_response_guardrail_transition_strip",
    );

    traceRunEnd(traceCtx, {
      status: "ok",
      durationMs: Date.now() - startedAt,
      summary: {
        message_len: payload.user_message.length,
        active_section: workflowAfter.active_section_id,
        intent: result.turn_intent?.task_type ?? result.planner_task_type,
        task: result.planner_task_type,
        next_question_id: workflowAfter.next_question_slot_id,
        reply_len: assistantText.length,
        tool_trace_count: result.tool_trace.length,
        extraction_ran: extractionRan,
        accepted_updates_count: diagnostics?.captured_fields_this_turn.length ?? 0,
        rejected_updates_count: 0,
        ambiguous_count: diagnostics?.deferred_fields.length ?? 0,
        workflow_phase_before: workflowBefore.phase,
        workflow_phase_after: workflowAfter.phase,
        section_index_before: sectionIndexBefore,
        section_index_after: sectionIndexAfter,
        confirm_interaction_opened: confirmInteractionOpened,
        response_guardrail_applied: responseGuardrailApplied,
        duration_ms: Date.now() - startedAt,
      },
    });

    await persistStateAndSession({
      sessionId: payload.session_id,
      state: stateRecord.state_jsonb,
      completionLevel: completion.completion_level,
      completionScore: completion.completion_score,
      preview: result.updated_preview ?? {},
    });

    if (typeof globalThis.gc === "function") globalThis.gc();

    return NextResponse.json({
      assistant_message: assistantText,
      interaction_module: result.interaction_module,
      updated_preview: result.updated_preview,
      workflow_state: result.workflow_state,
      planner_task_type: result.planner_task_type,
      model_route_used: result.model_route_used,
      tool_trace: result.tool_trace,
      planner_trace: result.planner_trace,
      context_window: getContextWindowInfo(),
      cumulative_tokens: getCumulativeTokenUsage(),
      current_section_index: stateRecord.state_jsonb.conversation_meta.current_section_index,
      current_section_name: getCurrentSectionName(stateRecord.state_jsonb),
      turn_intent: result.turn_intent,
      extraction_contract_summary: result.extraction_contract_summary,
      contract_validation_result: result.contract_validation_result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const detail = error instanceof Error ? error.stack : undefined;
    traceRunEnd(traceCtx, {
      status: "fail",
      durationMs: Date.now() - startedAt,
      summary: {
        route: "/api/interview/message",
        ...toErrorSummary(error),
      },
    });
    console.error("[interview/message] Error:", detail ?? message);
    return NextResponse.json(
      { error: message, ...(process.env.NODE_ENV !== "production" && detail ? { stack: detail } : {}) },
      { status: 400 },
    );
  }
}
