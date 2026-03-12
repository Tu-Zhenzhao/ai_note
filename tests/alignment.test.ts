import { describe, expect, test } from "vitest";
import { createInitialState, statusValue } from "@/lib/state";
import { advanceSectionIfComplete } from "@/server/rules/checklist";
import { selectNextPreviewSlot, syncPreviewSlots } from "@/server/services/preview-slots";
import { interviewUserPrompt } from "@/server/prompts/interview";

function setStrongPrimaryOffering(state: ReturnType<typeof createInitialState>, name: string) {
  state.product_service.primary_offering.value = {
    name,
    type: "API",
    description: name,
    target_user: "",
    main_use_case: "",
    status: "strong",
  };
  state.product_service.primary_offering.status = "strong";
}

describe("preview truth alignment", () => {
  test("does not leave company understanding while brand story is still missing", () => {
    const state = createInitialState("align-1");
    state.company_profile.company_one_liner = statusValue(
      "Ultrafilter provides search APIs for internal file retrieval.",
      "strong",
    );
    setStrongPrimaryOffering(state, "Search API");
    state.product_service.problem_solved = statusValue(
      ["Manual file search wastes time", "Data is hard to retrieve"],
      "strong",
    );
    state.product_service.key_differentiators = statusValue(
      ["Indexes multiple file types", "Works as a foundational search layer"],
      "strong",
    );

    syncPreviewSlots(state);
    const result = advanceSectionIfComplete(state);
    const nextSlot = selectNextPreviewSlot(state);

    expect(result.advanced).toBe(false);
    expect(result.newIndex).toBe(0);
    expect(nextSlot?.id).toBe("company_understanding.brand_story");
  });

  test("keeps audience understanding active until LinkedIn attraction goal is captured", () => {
    const state = createInitialState("align-2");
    state.conversation_meta.current_section_index = 1;
    state.market_audience.primary_audience.value = {
      label: "AI companies and manufacturing teams",
      roles: [],
      industries: [],
      company_size: [],
      regions: [],
      pain_points: [],
      desired_outcomes: [],
      content_resonance_angle: "",
      status: "strong",
    };
    state.market_audience.primary_audience.status = "strong";
    state.market_audience.audience_pain_points = statusValue(
      ["Manual image search is slow", "Internal data is hard to search"],
      "strong",
    );
    state.market_audience.audience_desired_outcomes = statusValue(
      ["Find files faster", "Make search self-serve"],
      "strong",
    );

    syncPreviewSlots(state);
    const result = advanceSectionIfComplete(state);
    const nextSlot = selectNextPreviewSlot(state);

    expect(result.advanced).toBe(false);
    expect(result.newIndex).toBe(1);
    expect(nextSlot?.question_target_field).toBe("market_audience.attraction_goal");
  });

  test("does not leave audience understanding when LinkedIn attraction goal is inferred but unconfirmed", () => {
    const state = createInitialState("align-2b");
    state.conversation_meta.current_section_index = 1;
    state.market_audience.primary_audience.value = {
      label: "Business leaders",
      roles: [],
      industries: [],
      company_size: [],
      regions: [],
      pain_points: [],
      desired_outcomes: [],
      content_resonance_angle: "",
      status: "strong",
    };
    state.market_audience.primary_audience.status = "strong";
    state.market_audience.audience_pain_points = statusValue(
      ["Too much manual document/image search"],
      "strong",
      false,
      "user_confirmed",
    );
    state.market_audience.audience_desired_outcomes = statusValue(
      ["Save time and reduce operational cost"],
      "strong",
      false,
      "user_confirmed",
    );
    state.market_audience.attraction_goal = statusValue(
      "Business leaders looking to move fast on small budgets",
      "strong",
      false,
      "ai_inferred",
    );

    syncPreviewSlots(state);
    const result = advanceSectionIfComplete(state);
    const nextSlot = selectNextPreviewSlot(state);

    expect(result.advanced).toBe(false);
    expect(result.newIndex).toBe(1);
    expect(nextSlot?.id).toBe("audience_understanding.linkedin_attraction_goal");
  });

  test("prompt still marks attraction goal as needed when it is inferred but unconfirmed", () => {
    const state = createInitialState("align-2c");
    state.conversation_meta.current_section_index = 1;
    state.market_audience.primary_audience.value = {
      label: "Business leaders",
      roles: [],
      industries: [],
      company_size: [],
      regions: [],
      pain_points: [],
      desired_outcomes: [],
      content_resonance_angle: "",
      status: "strong",
    };
    state.market_audience.primary_audience.status = "strong";
    state.market_audience.audience_pain_points = statusValue(
      ["Manual knowledge search is expensive"],
      "strong",
      false,
      "user_confirmed",
    );
    state.market_audience.audience_desired_outcomes = statusValue(
      ["Faster search with lower operating cost"],
      "strong",
      false,
      "user_confirmed",
    );
    state.market_audience.attraction_goal = statusValue(
      "Business leaders looking for practical ROI",
      "strong",
      false,
      "ai_inferred",
    );

    const prompt = interviewUserPrompt({
      userMessage: "We focus on business leaders with small budgets.",
      state,
      nextQuestion:
        "Who exactly do you want to attract on LinkedIn from this audience?",
      questionType: "clarify",
      capturedFieldsThisTurn: ["market_audience.attraction_goal"],
      capturedChecklistItemsThisTurn: [],
      recentMessages: [],
      sectionAdvanced: false,
      currentSectionName: "Audience Understanding",
    });

    expect(prompt).toContain("Still needed in this section:");
    expect(prompt).toContain("Who exactly do you want to attract on LinkedIn");
    expect(prompt).not.toContain("nothing — section complete");
  });

  test("advances at most one section per turn even when later sections are already prefilled", () => {
    const state = createInitialState("align-3");
    state.company_profile.company_one_liner = statusValue(
      "We provide search APIs for enterprise teams.",
      "strong",
    );
    state.brand_story.core_belief = statusValue(
      "Search should work across every file type without manual effort.",
      "strong",
    );
    state.brand_story.what_should_people_remember = statusValue(
      "We make your own data searchable without building infra first.",
      "strong",
    );
    setStrongPrimaryOffering(state, "Search API");
    state.product_service.problem_solved = statusValue(
      ["Internal search is slow", "Files are fragmented"],
      "strong",
    );
    state.product_service.key_differentiators = statusValue(
      ["Works across text and images", "API-first integration"],
      "strong",
    );

    state.market_audience.primary_audience.value = {
      label: "Operations and IT teams",
      roles: [],
      industries: [],
      company_size: [],
      regions: [],
      pain_points: [],
      desired_outcomes: [],
      content_resonance_angle: "",
      status: "strong",
    };
    state.market_audience.primary_audience.status = "strong";
    state.market_audience.audience_pain_points = statusValue(
      ["Knowledge retrieval is manual", "Search takes too long"],
      "strong",
    );
    state.market_audience.audience_desired_outcomes = statusValue(
      ["Retrieve files instantly", "Reduce manual effort"],
      "strong",
    );
    state.market_audience.attraction_goal = statusValue(
      "Technical teams evaluating search infrastructure",
      "strong",
    );

    syncPreviewSlots(state);
    const result = advanceSectionIfComplete(state);

    expect(result.advanced).toBe(true);
    expect(result.newIndex).toBe(1);
    expect(state.conversation_meta.current_section_index).toBe(1);
  });
});
