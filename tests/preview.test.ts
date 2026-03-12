import { describe, expect, test } from "vitest";
import { createInitialState, statusValue } from "@/lib/state";
import { evaluateCompletion } from "@/server/rules/completion";
import { composePreview } from "@/server/services/preview";

describe("preview composition and gating", () => {
  test("preview includes six required sections", () => {
    const state = createInitialState("preview-1");
    const preview = composePreview(state) as any;

    expect(preview.sections.company_understanding).toBeDefined();
    expect(preview.sections.audience_understanding).toBeDefined();
    expect(preview.sections.linkedin_content_strategy).toBeDefined();
    expect(preview.sections.evidence_and_proof_assets).toBeDefined();
    expect(preview.sections.ai_suggested_content_directions).toBeDefined();
    expect(preview.sections.generation_plan).toBeDefined();
    expect(preview.turn_delta).toBeDefined();
    expect(preview.open_items).toBeDefined();
    expect(Array.isArray(preview.confirmation_chips)).toBe(true);
  });

  test("generation is blocked before checkpoint approval", () => {
    const state = createInitialState("preview-2");
    state.company_profile.company_one_liner = statusValue("We help teams create better LinkedIn strategy.", "strong");
    state.company_profile.industry = statusValue(["marketing"], "strong");
    state.company_profile.business_model = statusValue(["service"], "strong");

    state.brand_story.founding_story = statusValue("Started after seeing repetitive content failures.", "strong");
    state.brand_story.mission_statement = statusValue("Build useful LinkedIn content systems.", "strong");
    state.brand_story.what_should_people_remember = statusValue("Practical strategy", "strong");

    state.product_service.primary_offering.status = "strong";
    state.product_service.problem_solved = statusValue(["low-quality content"], "strong");
    state.product_service.key_differentiators = statusValue(["interview-first workflow"], "strong");

    state.market_audience.primary_audience.status = "strong";
    state.market_audience.audience_pain_points = statusValue(["content inconsistency"], "strong");
    state.market_audience.audience_desired_outcomes = statusValue(["authority"], "strong");
    state.market_audience.attraction_goal = statusValue("founders", "strong");

    state.linkedin_content_strategy.primary_content_goal = statusValue("Build authority", "strong");
    state.linkedin_content_strategy.desired_content_formats = statusValue(["LinkedIn Carousel"], "strong");
    state.linkedin_content_strategy.priority_format = statusValue("LinkedIn Carousel", "strong");

    state.content_preferences.preferred_tone = statusValue(["insightful"], "strong");
    state.content_preferences.preferred_voice = statusValue(["expert"], "strong");
    state.content_preferences.preferred_style_tags = statusValue(["educational"], "strong");
    state.content_preferences.preferred_content_depth = statusValue("mid", "strong");

    state.evidence_library.case_studies = statusValue(
      [
        {
          title: "Proof",
          client_type: "B2B",
          problem: "",
          solution: "",
          result: "",
          metrics: [],
          permission_level: "public",
          status: "strong",
        },
      ],
      "strong",
    );
    state.evidence_library.assets = statusValue(
      [
        {
          asset_type: "screenshot",
          asset_name: "dashboard",
          description: "",
          link_or_storage_ref: null,
          usable_for_formats: ["LinkedIn Carousel"],
          usage_limitations: [],
          status: "strong",
        },
      ],
      "strong",
    );

    state.content_readiness.ai_suggested_first_content_topic = statusValue("topic", "strong", true);
    state.content_readiness.ai_suggested_first_content_format = statusValue("LinkedIn Carousel", "strong", true);
    state.content_readiness.ai_suggested_first_content_goal = statusValue("goal", "strong", true);

    state.system_assessment.checkpoint_approved = false;

    const result = evaluateCompletion(state);
    expect(result.completion_level).toBe("minimally_ready");
    expect(result.generation_permission_flag).toBe(false);
  });
});
