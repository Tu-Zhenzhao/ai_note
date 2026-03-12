import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInterviewRepository } from "@/server/repo";
import { evaluateCompletion } from "@/server/rules/completion";
import { composePreview } from "@/server/services/preview";
import { persistStateAndSession } from "@/server/services/persistence";
import { confirmPreviewSlots } from "@/server/services/preview-slots";
import { syncWorkflowState } from "@/server/services/workflow";

const bodySchema = z.object({
  session_id: z.string().min(1),
  section_id: z.enum([
    "company_understanding",
    "audience_understanding",
    "linkedin_content_strategy",
    "evidence_and_proof_assets",
    "ai_suggested_content_directions",
    "generation_plan",
  ]),
  edited_content: z.record(z.string(), z.any()),
});

function slotIdsForEditedField(sectionId: string, fieldKey: string): string[] {
  const table: Record<string, Record<string, string[]>> = {
    company_understanding: {
      company_summary: ["company_understanding.company_summary"],
      short_brand_story: ["company_understanding.brand_story"],
      what_to_remember: ["company_understanding.brand_story"],
      main_offering: ["company_understanding.main_offering"],
      problem_solved: ["company_understanding.problem_solved"],
      differentiator: ["company_understanding.differentiator"],
    },
    audience_understanding: {
      primary_audience: ["audience_understanding.primary_audience"],
      core_problems: ["audience_understanding.core_problems"],
      desired_outcomes: ["audience_understanding.desired_outcomes"],
      who_to_attract_on_linkedin: ["audience_understanding.linkedin_attraction_goal"],
    },
    linkedin_content_strategy: {
      main_content_goal: ["linkedin_content_strategy.main_content_goal"],
      content_positioning: ["linkedin_content_strategy.content_positioning"],
      topics_to_emphasize: ["linkedin_content_strategy.topics_and_formats"],
      topics: ["linkedin_content_strategy.topics_and_formats"],
      topics_to_avoid: ["linkedin_content_strategy.topics_to_avoid"],
    },
    evidence_and_proof_assets: {
      proof_points: ["evidence_and_proof_assets.proof_anchor"],
      narrative_proof: ["evidence_and_proof_assets.proof_anchor"],
      metrics_proof_points: ["evidence_and_proof_assets.proof_anchor"],
      supporting_assets: ["evidence_and_proof_assets.supporting_assets"],
      missing_proof_areas: ["evidence_and_proof_assets.supporting_assets"],
    },
    generation_plan: {
      topic: ["generation_plan.first_topic"],
      format: ["generation_plan.first_format"],
      goal: ["generation_plan.proof_plan"],
      proof_plan: ["generation_plan.proof_plan"],
      planned_first_topic: ["generation_plan.first_topic"],
      planned_format: ["generation_plan.first_format"],
    },
    ai_suggested_content_directions: {
      topic: ["generation_plan.first_topic"],
      format: ["generation_plan.first_format"],
      goal: ["generation_plan.proof_plan"],
    },
  };

  return table[sectionId]?.[fieldKey] ?? [];
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
    state.system_assessment.checkpoint_approved = false;
    // Intentional behavior: suggest-change is a direct user edit, not an AI rewrite step.
    const confirmedSlotIds = new Set<string>();

    if (payload.section_id === "company_understanding") {
      Object.keys(payload.edited_content).forEach((fieldKey) => {
        slotIdsForEditedField(payload.section_id, fieldKey).forEach((slotId) => {
          confirmedSlotIds.add(slotId);
        });
      });
      const oneLiner = String(payload.edited_content.company_summary ?? "");
      const offering = String(payload.edited_content.main_offering ?? "");
      const problemSolved = payload.edited_content.problem_solved;
      const differentiator = payload.edited_content.differentiator;
      const shortBrandStory = String(payload.edited_content.short_brand_story ?? "");
      const remember = String(payload.edited_content.what_to_remember ?? "");
      state.company_profile.company_one_liner.value = oneLiner;
      state.company_profile.company_one_liner.status = oneLiner ? "verified" : "missing";
      state.company_profile.company_one_liner.verification_state = oneLiner ? "user_confirmed" : "unverified";
      if (offering) {
        state.product_service.primary_offering.value = {
          ...(state.product_service.primary_offering.value ?? {
            name: "",
            type: "offering",
            description: "",
            target_user: "",
            main_use_case: "",
            status: "partial",
          }),
          name: offering,
          description: offering,
          status: "verified",
        };
        state.product_service.primary_offering.status = "verified";
        state.product_service.primary_offering.verification_state = "user_confirmed";
      }
      if (shortBrandStory) {
        state.brand_story.core_belief.value = shortBrandStory;
        state.brand_story.core_belief.status = "verified";
        state.brand_story.core_belief.verification_state = "user_confirmed";
      }
      if (problemSolved !== undefined) {
        const problems = Array.isArray(problemSolved)
          ? problemSolved.map(String).filter(Boolean)
          : String(problemSolved)
              .split(/[;,]/)
              .map((item) => item.trim())
              .filter(Boolean);
        state.product_service.problem_solved.value = problems;
        state.product_service.problem_solved.status = problems.length > 1 ? "verified" : problems.length ? "strong" : "missing";
        state.product_service.problem_solved.verification_state = problems.length > 0 ? "user_confirmed" : "unverified";
      }
      if (differentiator !== undefined) {
        const diffs = Array.isArray(differentiator)
          ? differentiator.map(String).filter(Boolean)
          : String(differentiator)
              .split(/[;,]/)
              .map((item) => item.trim())
              .filter(Boolean);
        state.product_service.key_differentiators.value = diffs;
        state.product_service.key_differentiators.status = diffs.length > 1 ? "verified" : diffs.length ? "strong" : "missing";
        state.product_service.key_differentiators.verification_state = diffs.length > 0 ? "user_confirmed" : "unverified";
      }
      state.brand_story.what_should_people_remember.value = remember;
      state.brand_story.what_should_people_remember.status = remember ? "verified" : "partial";
      state.brand_story.what_should_people_remember.verification_state = remember ? "user_confirmed" : "unverified";
      state.preview_projection.company_understanding.meta.user_edited = true;
      state.preview_projection.company_understanding.meta.last_user_action = "edit";
    }

    if (payload.section_id === "audience_understanding") {
      Object.keys(payload.edited_content).forEach((fieldKey) => {
        slotIdsForEditedField(payload.section_id, fieldKey).forEach((slotId) => {
          confirmedSlotIds.add(slotId);
        });
      });
      const audience = String(payload.edited_content.primary_audience ?? "");
      const pains = Array.isArray(payload.edited_content.core_problems)
        ? payload.edited_content.core_problems.map(String)
        : [];
      const outcomes = Array.isArray(payload.edited_content.desired_outcomes)
        ? payload.edited_content.desired_outcomes.map(String)
        : [];
      const attraction = String(payload.edited_content.who_to_attract_on_linkedin ?? "");
      state.market_audience.primary_audience.value = {
        ...(state.market_audience.primary_audience.value ?? {
          label: "",
          roles: [],
          industries: [],
          company_size: [],
          regions: [],
          pain_points: [],
          desired_outcomes: [],
          content_resonance_angle: "",
          status: "partial",
        }),
        label: audience,
        pain_points: pains,
        status: audience ? "verified" : "partial",
      };
      state.market_audience.primary_audience.status = audience ? "verified" : "partial";
      state.market_audience.primary_audience.verification_state = audience ? "user_confirmed" : "unverified";
      state.market_audience.audience_pain_points.value = pains;
      state.market_audience.audience_pain_points.status = pains.length > 1 ? "strong" : pains.length ? "partial" : "missing";
      state.market_audience.audience_desired_outcomes.value = outcomes;
      state.market_audience.audience_desired_outcomes.status = outcomes.length > 1 ? "strong" : outcomes.length ? "partial" : "missing";
      state.market_audience.attraction_goal.value = attraction;
      state.market_audience.attraction_goal.status = attraction ? "verified" : "missing";
      state.market_audience.attraction_goal.verification_state = attraction ? "user_confirmed" : "unverified";
      state.preview_projection.audience_understanding.meta.user_edited = true;
      state.preview_projection.audience_understanding.meta.last_user_action = "edit";
    }

    if (payload.section_id === "linkedin_content_strategy") {
      Object.keys(payload.edited_content).forEach((fieldKey) => {
        slotIdsForEditedField(payload.section_id, fieldKey).forEach((slotId) => {
          confirmedSlotIds.add(slotId);
        });
      });
      const goal = String(payload.edited_content.main_content_goal ?? "");
      const topics = Array.isArray(payload.edited_content.topics) ? payload.edited_content.topics.map(String) : [];
      const topicsToEmphasize = Array.isArray(payload.edited_content.topics_to_emphasize)
        ? payload.edited_content.topics_to_emphasize.map(String)
        : [];
      const topicsToAvoid = Array.isArray(payload.edited_content.topics_to_avoid)
        ? payload.edited_content.topics_to_avoid.map(String)
        : [];
      const positioning = String(payload.edited_content.content_positioning ?? "");
      state.linkedin_content_strategy.primary_content_goal.value = goal;
      state.linkedin_content_strategy.primary_content_goal.status = goal ? "verified" : "missing";
      state.linkedin_content_strategy.primary_content_goal.verification_state = goal ? "user_confirmed" : "unverified";
      const finalTopics = topicsToEmphasize.length > 0 ? topicsToEmphasize : topics;
      state.linkedin_content_strategy.topics_they_want_to_talk_about.value = finalTopics;
      state.linkedin_content_strategy.topics_they_want_to_talk_about.status = finalTopics.length > 1 ? "strong" : finalTopics.length ? "partial" : "missing";
      state.linkedin_content_strategy.topics_to_avoid_or_deprioritize.value = topicsToAvoid;
      state.linkedin_content_strategy.topics_to_avoid_or_deprioritize.status = topicsToAvoid.length > 1 ? "strong" : topicsToAvoid.length ? "partial" : "missing";
      state.linkedin_content_strategy.desired_brand_perception.value = positioning ? [positioning] : [];
      state.linkedin_content_strategy.desired_brand_perception.status = positioning ? "verified" : "missing";
      state.linkedin_content_strategy.desired_brand_perception.verification_state = positioning ? "user_confirmed" : "unverified";
      state.preview_projection.linkedin_content_strategy.meta.user_edited = true;
      state.preview_projection.linkedin_content_strategy.meta.last_user_action = "edit";
    }

    if (payload.section_id === "evidence_and_proof_assets") {
      Object.keys(payload.edited_content).forEach((fieldKey) => {
        slotIdsForEditedField(payload.section_id, fieldKey).forEach((slotId) => {
          confirmedSlotIds.add(slotId);
        });
      });
      const proofs = Array.isArray(payload.edited_content.proof_points)
        ? payload.edited_content.proof_points.map(String)
        : [];
      const narratives = Array.isArray(payload.edited_content.narrative_proof)
        ? payload.edited_content.narrative_proof.map(String)
        : [];
      const metrics = Array.isArray(payload.edited_content.metrics_proof_points)
        ? payload.edited_content.metrics_proof_points.map(String)
        : [];
      const assets = Array.isArray(payload.edited_content.supporting_assets)
        ? payload.edited_content.supporting_assets.map(String)
        : [];
      state.evidence_library.strongest_proof_points.value = proofs;
      state.evidence_library.strongest_proof_points.status = proofs.length > 1 ? "strong" : proofs.length ? "partial" : "missing";
      state.evidence_library.strongest_proof_points.verification_state = proofs.length > 0 ? "user_confirmed" : "unverified";
      if (narratives.length > 0) {
        state.evidence_library.case_studies.value = narratives.map((item) => ({
          title: item,
          client_type: "",
          problem: item,
          solution: "",
          result: "",
          metrics: [],
          permission_level: "public",
          status: "verified",
        }));
        state.evidence_library.case_studies.status = "verified";
        state.evidence_library.case_studies.verification_state = "user_confirmed";
      }
      if (metrics.length > 0) {
        state.evidence_library.metrics_and_proof_points.value = metrics.map((item) => ({
          metric_name: "User metric",
          metric_value: item,
          metric_context: "Edited in review panel",
          timeframe: "",
          confidence_level: "medium",
          can_publish_publicly: true,
          status: "verified",
        }));
        state.evidence_library.metrics_and_proof_points.status = "verified";
        state.evidence_library.metrics_and_proof_points.verification_state = "user_confirmed";
      }
      if (assets.length > 0) {
        state.evidence_library.assets.value = assets.map((item) => ({
          asset_type: "general",
          asset_name: item,
          description: item,
          link_or_storage_ref: null,
          usable_for_formats: ["LinkedIn Carousel"],
          usage_limitations: [],
          status: "verified",
        }));
        state.evidence_library.assets.status = "verified";
        state.evidence_library.assets.verification_state = "user_confirmed";
      }
      state.preview_projection.evidence_and_proof.meta.user_edited = true;
      state.preview_projection.evidence_and_proof.meta.last_user_action = "edit";
    }

    if (payload.section_id === "ai_suggested_content_directions" || payload.section_id === "generation_plan") {
      Object.keys(payload.edited_content).forEach((fieldKey) => {
        slotIdsForEditedField(payload.section_id, fieldKey).forEach((slotId) => {
          confirmedSlotIds.add(slotId);
        });
      });
      const topic = String(payload.edited_content.topic ?? "");
      const format = String(payload.edited_content.format ?? "LinkedIn Carousel");
      const goal = String(payload.edited_content.goal ?? "Build authority and attract conversations");
      state.content_readiness.ai_suggested_first_content_topic.value = topic;
      state.content_readiness.ai_suggested_first_content_topic.status = topic ? "verified" : "missing";
      state.content_readiness.ai_suggested_first_content_topic.verification_state = topic ? "user_confirmed" : "unverified";
      state.content_readiness.ai_suggested_first_content_topic.ai_suggested = false;
      state.content_readiness.ai_suggested_first_content_format.value = format;
      state.content_readiness.ai_suggested_first_content_format.status = "verified";
      state.content_readiness.ai_suggested_first_content_format.verification_state = "user_confirmed";
      state.content_readiness.ai_suggested_first_content_format.ai_suggested = false;
      state.content_readiness.ai_suggested_first_content_goal.value = goal;
      state.content_readiness.ai_suggested_first_content_goal.status = "verified";
      state.content_readiness.ai_suggested_first_content_goal.verification_state = "user_confirmed";
      state.content_readiness.ai_suggested_first_content_goal.ai_suggested = false;
      state.preview_projection.generation_plan.meta.user_edited = true;
      state.preview_projection.generation_plan.meta.last_user_action = "edit";
    }

    if (confirmedSlotIds.size > 0) {
      confirmPreviewSlots(state, Array.from(confirmedSlotIds));
    }
    syncWorkflowState(state);

    const completionState = evaluateCompletion(state);
    const preview = composePreview(state);

    await persistStateAndSession({
      sessionId: payload.session_id,
      state,
      completionLevel: completionState.completion_level,
      completionScore: completionState.completion_score,
      preview,
    });

    return NextResponse.json({
      updated_preview: preview,
      updated_internal_state: {
        module_completion_map: state.system_assessment.module_completion_map,
        checklist_completion_map: state.system_assessment.checklist_completion_map,
        checkpoint_approved: state.system_assessment.checkpoint_approved,
      },
      completion_state: completionState,
      workflow_state: state.workflow,
      current_section_index: state.conversation_meta.current_section_index,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
