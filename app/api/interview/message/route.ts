import { NextRequest, NextResponse } from "next/server";
import { newMessageId, getOrCreateSession } from "@/server/services/session";
import { getInterviewRepository } from "@/server/repo";
import { runInterviewTurn } from "@/server/orchestration/engine";
import { persistStateAndSession } from "@/server/services/persistence";
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

    const result = await runInterviewTurn({
      sessionId: payload.session_id,
      userMessage: payload.user_message,
      userTurnId: userMessage.id,
      state: stateRecord.state_jsonb,
    });

    const assistantText = result.assistantMessage ?? "Could you share a bit more detail?";

    await repo.addMessage({
      id: newMessageId(),
      session_id: payload.session_id,
      role: "assistant",
      content: assistantText,
      created_at: new Date().toISOString(),
    });

    const completion = result.completionState;
    if (!completion) {
      throw new Error("Completion state missing after orchestration");
    }

    await persistStateAndSession({
      sessionId: payload.session_id,
      state: result.state,
      completionLevel: completion.completion_level,
      completionScore: completion.completion_score,
      preview: result.preview ?? {},
    });

    return NextResponse.json({
      assistant_message: assistantText,
      updated_preview: result.preview,
      completion_state: completion,
      next_action: result.nextAction ?? result.state.system_assessment.next_action,
      handoff_summary: result.handoffSummary ?? null,
      captured_fields_this_turn: result.state.system_assessment.last_turn_diagnostics.captured_fields_this_turn,
      captured_checklist_items_this_turn: result.state.system_assessment.last_turn_diagnostics.captured_checklist_items_this_turn,
      deferred_fields: result.state.system_assessment.last_turn_diagnostics.deferred_fields,
      conflicts_detected: result.state.system_assessment.last_turn_diagnostics.conflicts_detected,
      question_reason: result.questionReason ?? result.state.system_assessment.last_turn_diagnostics.question_reason,
      planner_action: result.plannerAction ?? result.state.system_assessment.last_planner_action,
      question_style: result.questionStyle ?? result.state.system_assessment.last_question_style,
      checkpoint_recommended:
        typeof result.checkpointRecommended === "boolean"
          ? result.checkpointRecommended
          : result.state.system_assessment.checkpoint_recommended,
      user_facing_progress_note:
        result.userFacingProgressNote ?? result.state.system_assessment.last_user_facing_progress_note,
      model_route_used: result.state.system_assessment.model_route_used,
      planner_confidence: completion.planner_confidence,
      verification_coverage: completion.verification_coverage,
      open_checklist_items: completion.open_checklist_items,
      current_section_index: result.state.conversation_meta.current_section_index,
      current_section_name: result.currentSectionName ?? null,
      section_advanced: result.sectionAdvanced ?? false,
      workflow_state: result.state.workflow,
      context_window: result.contextWindowInfo ?? null,
      cumulative_tokens: result.cumulativeTokens ?? null,
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
