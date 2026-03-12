import { describe, expect, test } from "vitest";
import { createInitialState, statusValue } from "@/lib/state";
import { evaluateCompletion } from "@/server/rules/completion";

function makeGenerationReadyState() {
  const state = createInitialState("test-ready");

  state.company_profile.company_one_liner = statusValue("We help B2B SaaS teams turn product value into LinkedIn content.", "verified");
  state.company_profile.industry = statusValue(["B2B SaaS"], "strong");
  state.company_profile.business_model = statusValue(["service"], "strong");

  state.brand_story.founding_story = statusValue("Founder saw repeated confusion in product messaging and built a strategy studio.", "strong");
  state.brand_story.mission_statement = statusValue("Make complex products easy to trust and buy.", "strong");
  state.brand_story.what_should_people_remember = statusValue("Practical clarity over hype.", "strong");

  state.product_service.primary_offering.value = {
    name: "LinkedIn Strategy Sprint",
    type: "service",
    description: "Positioning and content planning",
    target_user: "B2B founders",
    main_use_case: "Authority building",
    status: "strong",
  };
  state.product_service.primary_offering.status = "strong";
  state.product_service.problem_solved = statusValue(["Inconsistent messaging"], "strong");
  state.product_service.key_differentiators = statusValue(["Interview-led strategist workflow"], "strong");

  state.market_audience.primary_audience.value = {
    label: "B2B SaaS founders",
    roles: ["Founder"],
    industries: ["SaaS"],
    company_size: ["SMB"],
    regions: ["US"],
    pain_points: ["Hard to explain product value"],
    desired_outcomes: ["Higher-quality inbound conversations"],
    content_resonance_angle: "operator-led",
    status: "strong",
  };
  state.market_audience.primary_audience.status = "verified";
  state.market_audience.audience_pain_points = statusValue(["Hard to explain product value"], "strong");
  state.market_audience.audience_desired_outcomes = statusValue(["More qualified inbound"], "strong");
  state.market_audience.attraction_goal = statusValue("Founders and growth leaders", "strong");

  state.linkedin_content_strategy.primary_content_goal = statusValue("Build authority and attract inbound leads", "verified");
  state.linkedin_content_strategy.desired_content_formats = statusValue(["LinkedIn Carousel", "LinkedIn Long Image"], "strong");
  state.linkedin_content_strategy.priority_format = statusValue("LinkedIn Carousel", "strong");
  state.linkedin_content_strategy.topics_they_want_to_talk_about = statusValue(["Messaging clarity"], "strong");

  state.content_preferences.preferred_tone = statusValue(["Analytical"], "strong");
  state.content_preferences.preferred_voice = statusValue(["Expert"], "strong");
  state.content_preferences.preferred_style_tags = statusValue(["Educational"], "strong");
  state.content_preferences.preferred_content_depth = statusValue("mid-depth", "strong");

  state.evidence_library.case_studies = statusValue(
    [
      {
        title: "SaaS positioning case",
        client_type: "SaaS",
        problem: "unclear value",
        solution: "content system",
        result: "improved qualified lead conversations",
        metrics: ["32% lift in demo conversion"],
        permission_level: "public",
        status: "strong",
      },
    ],
    "strong",
  );
  state.evidence_library.metrics_and_proof_points = statusValue(
    [
      {
        metric_name: "demo conversion",
        metric_value: "+32%",
        metric_context: "after 8 weeks",
        timeframe: "8 weeks",
        confidence_level: "high",
        can_publish_publicly: true,
        status: "strong",
      },
    ],
    "strong",
  );

  state.content_dislikes.disliked_tone = statusValue(["Hype-heavy"], "partial");
  state.constraints_and_boundaries.forbidden_topics = statusValue(["Client confidential numbers"], "strong");
  state.constraints_and_boundaries.claims_policy = statusValue("Avoid unverifiable claims", "strong");
  state.user_concerns.main_concerns = statusValue(["Misrepresentation"], "partial");

  state.content_readiness.ai_suggested_first_content_topic = statusValue(
    "Why B2B SaaS founders struggle to explain value on LinkedIn",
    "verified",
    false,
  );
  state.content_readiness.ai_suggested_first_content_format = statusValue("LinkedIn Carousel", "verified", false);
  state.content_readiness.ai_suggested_first_content_goal = statusValue("Attract inbound conversations", "verified", false);

  state.system_assessment.checkpoint_approved = true;

  return state;
}

describe("completion engine", () => {
  test("reaches generation_ready only when hard gates pass and checkpoint is approved", () => {
    const state = makeGenerationReadyState();
    const result = evaluateCompletion(state);

    expect(result.completion_level).toBe("generation_ready");
    expect(result.generation_permission_flag).toBe(true);
    expect(result.red_line_blockers).toHaveLength(0);
    expect(result.completion_score).toBeGreaterThanOrEqual(75);
  });

  test("narrative-only can be minimally_ready but not generation_ready", () => {
    const state = makeGenerationReadyState();

    state.evidence_library.case_studies = statusValue([], "missing");
    state.evidence_library.metrics_and_proof_points = statusValue([], "missing");
    state.evidence_library.assets = statusValue([], "missing");
    state.evidence_library.source_material_links = [];

    const result = evaluateCompletion(state);

    expect(result.completion_level).toBe("minimally_ready");
    expect(result.generation_permission_flag).toBe(false);
    expect(result.red_line_blockers).toContain("evidence_foundation_missing");
  });

  test("score threshold alone does not bypass blockers", () => {
    const state = makeGenerationReadyState();
    state.linkedin_content_strategy.primary_content_goal = statusValue("", "missing");

    const result = evaluateCompletion(state);

    expect(result.completion_score).toBeGreaterThanOrEqual(75);
    expect(result.completion_level).toBe("minimally_ready");
    expect(result.generation_permission_flag).toBe(false);
    expect(result.red_line_blockers).toContain("linkedin_goal_unclear");
  });

  test("high fatigue with partial progress prefers checkpoint action", () => {
    const state = makeGenerationReadyState();
    state.system_assessment.user_fatigue_risk = "high";
    state.system_assessment.checkpoint_approved = false;
    state.evidence_library.case_studies = statusValue([], "missing");
    state.evidence_library.metrics_and_proof_points = statusValue([], "missing");
    state.evidence_library.assets = statusValue([], "missing");

    const result = evaluateCompletion(state);
    expect(result.completion_level).toBe("handoff_ready");
    expect(state.system_assessment.next_action).toMatch(/checkpoint|handoff/);
  });
});
