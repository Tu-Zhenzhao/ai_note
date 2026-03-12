import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getInterviewRepository } from "@/server/repo";
import { evaluateCompletion } from "@/server/rules/completion";
import { composePreview } from "@/server/services/preview";
import { persistStateAndSession } from "@/server/services/persistence";
import { confirmPreviewSectionSlots } from "@/server/services/preview-slots";
import { confirmPendingSectionAndAdvance, syncWorkflowState } from "@/server/services/workflow";

const bodySchema = z.object({
  session_id: z.string().min(1),
  approved_sections: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

function verifyIfStrong<T extends { status: string; verification_state?: string }>(field: T) {
  if (field.status === "strong") {
    field.status = "verified";
    field.verification_state = "user_confirmed";
  }
  if (field.status === "verified") {
    field.verification_state = "user_confirmed";
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    const repo = getInterviewRepository();
    const stateRecord = await repo.getState(payload.session_id);
    if (!stateRecord) {
      return NextResponse.json({ error: "Session state not found" }, { status: 404 });
    }

    const state = stateRecord.state_jsonb;
    const sections = payload.all
      ? [
          "company_understanding",
          "audience_understanding",
          "linkedin_content_strategy",
          "evidence_and_proof_assets",
          "ai_suggested_content_directions",
          "generation_plan",
        ]
      : payload.approved_sections ?? [];

    for (const section of sections) {
      if (section === "company_understanding") {
        verifyIfStrong(state.company_profile.company_one_liner);
        verifyIfStrong(state.brand_story.founding_story);
        verifyIfStrong(state.brand_story.core_belief);
        verifyIfStrong(state.brand_story.what_should_people_remember);
        verifyIfStrong(state.product_service.primary_offering);
        verifyIfStrong(state.product_service.problem_solved);
        verifyIfStrong(state.product_service.key_differentiators);
        confirmPreviewSectionSlots(state, "company_understanding");
        state.preview_projection.company_understanding.meta.user_confirmed = true;
        state.preview_projection.company_understanding.meta.last_user_action = "confirm";
      }

      if (section === "audience_understanding") {
        verifyIfStrong(state.market_audience.primary_audience);
        verifyIfStrong(state.market_audience.audience_pain_points);
        verifyIfStrong(state.market_audience.audience_desired_outcomes);
        verifyIfStrong(state.market_audience.attraction_goal);
        confirmPreviewSectionSlots(state, "audience_understanding");
        state.preview_projection.audience_understanding.meta.user_confirmed = true;
        state.preview_projection.audience_understanding.meta.last_user_action = "confirm";
      }

      if (section === "linkedin_content_strategy") {
        verifyIfStrong(state.linkedin_content_strategy.primary_content_goal);
        verifyIfStrong(state.linkedin_content_strategy.desired_brand_perception);
        verifyIfStrong(state.linkedin_content_strategy.topics_they_want_to_talk_about);
        verifyIfStrong(state.linkedin_content_strategy.topics_to_avoid_or_deprioritize);
        confirmPreviewSectionSlots(state, "linkedin_content_strategy");
        state.preview_projection.linkedin_content_strategy.meta.user_confirmed = true;
        state.preview_projection.linkedin_content_strategy.meta.last_user_action = "confirm";
      }

      if (section === "evidence_and_proof_assets") {
        verifyIfStrong(state.evidence_library.case_studies);
        verifyIfStrong(state.evidence_library.metrics_and_proof_points);
        verifyIfStrong(state.evidence_library.assets);
        confirmPreviewSectionSlots(state, "evidence_and_proof_assets");
        state.preview_projection.evidence_and_proof.meta.user_confirmed = true;
        state.preview_projection.evidence_and_proof.meta.last_user_action = "confirm";
      }

      if (section === "ai_suggested_content_directions" || section === "generation_plan") {
        verifyIfStrong(state.content_readiness.ai_suggested_first_content_topic);
        verifyIfStrong(state.content_readiness.ai_suggested_first_content_format);
        verifyIfStrong(state.content_readiness.ai_suggested_first_content_goal);
        confirmPreviewSectionSlots(state, "generation_plan");
        state.preview_projection.generation_plan.meta.user_confirmed = true;
        state.preview_projection.generation_plan.meta.last_user_action = "confirm";
      }
    }

    for (const section of sections) {
      if (section === "ai_suggested_content_directions") {
        confirmPendingSectionAndAdvance(state, "generation_plan");
      } else if (
        section === "company_understanding" ||
        section === "audience_understanding" ||
        section === "linkedin_content_strategy" ||
        section === "evidence_and_proof_assets" ||
        section === "generation_plan"
      ) {
        confirmPendingSectionAndAdvance(state, section);
      }
    }

    if (payload.all) {
      state.system_assessment.checkpoint_approved = true;
      state.conversation_meta.interview_stage = "checkpoint";
    }
    syncWorkflowState(state);

    const completionState = evaluateCompletion(state);
    const preview = composePreview(state);

    if (payload.all) {
      await repo.addCheckpointSnapshot({
        id: randomUUID(),
        session_id: payload.session_id,
        snapshot_json: {
          approved_sections: sections,
          completion_state: completionState,
          preview_summary: preview.header?.subtitle ?? "Checkpoint approved by user.",
        },
        user_confirmed: true,
        created_at: new Date().toISOString(),
      });
    }

    await persistStateAndSession({
      sessionId: payload.session_id,
      state,
      completionLevel: completionState.completion_level,
      completionScore: completionState.completion_score,
      preview,
    });

    return NextResponse.json({
      updated_preview: preview,
      updated_verified_fields: {
        company_one_liner: state.company_profile.company_one_liner.status,
        primary_audience: state.market_audience.primary_audience.status,
        main_content_goal: state.linkedin_content_strategy.primary_content_goal.status,
        ai_suggested_first_content_topic: state.content_readiness.ai_suggested_first_content_topic.status,
      },
      generation_ready_flag: completionState.generation_permission_flag,
      completion_state: completionState,
      workflow_state: state.workflow,
      current_section_index: state.conversation_meta.current_section_index,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
