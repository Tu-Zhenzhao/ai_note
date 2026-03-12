import { describe, expect, test, vi } from "vitest";
import { createInitialState, statusValue } from "@/lib/state";
import {
  confirmPendingSectionAndAdvance,
  syncWorkflowState,
} from "@/server/services/workflow";

vi.mock("@/server/model/adapters", () => ({
  generateModelText: vi.fn(async () =>
    "That completes the Audience Understanding section. Let's move to LinkedIn Content Strategy.",
  ),
}));

import { generateAssistantResponse } from "@/server/services/assistant";

describe("workflow consistency", () => {
  test("enters confirming_section when required slots are complete", () => {
    const state = createInitialState("wf-1");
    state.company_profile.company_one_liner = statusValue(
      "We provide search APIs for internal data.",
      "strong",
      false,
      "user_confirmed",
    );
    state.brand_story.core_belief = statusValue(
      "Search should be simple and universal.",
      "strong",
      false,
      "user_confirmed",
    );
    state.brand_story.what_should_people_remember = statusValue(
      "You can search every file type quickly.",
      "strong",
      false,
      "user_confirmed",
    );
    state.product_service.primary_offering.value = {
      name: "Search API",
      type: "API",
      description: "Search API",
      target_user: "",
      main_use_case: "",
      status: "strong",
    };
    state.product_service.primary_offering.status = "strong";
    state.product_service.primary_offering.verification_state = "user_confirmed";
    state.product_service.problem_solved = statusValue(
      ["Manual retrieval is too slow"],
      "strong",
      false,
      "user_confirmed",
    );
    state.product_service.key_differentiators = statusValue(
      ["Works across text and image data"],
      "strong",
      false,
      "user_confirmed",
    );

    syncWorkflowState(state);

    expect(state.workflow.phase).toBe("confirming_section");
    expect(state.workflow.pending_review_section_id).toBe("company_understanding");
  });

  test("confirming a pending section advances workflow deterministically", () => {
    const state = createInitialState("wf-2");
    state.workflow.phase = "confirming_section";
    state.workflow.pending_review_section_id = "company_understanding";
    state.conversation_meta.current_section_index = 0;

    const advanced = confirmPendingSectionAndAdvance(
      state,
      "company_understanding",
    );

    expect(advanced).toBe(true);
    expect(state.conversation_meta.current_section_index).toBe(1);
    expect(state.workflow.pending_review_section_id).toBe(null);
    expect(state.workflow.active_section_id).toBe("audience_understanding");
  });

  test("assistant strips unauthorized section transition claims", async () => {
    const state = createInitialState("wf-3");
    state.conversation_meta.current_section_index = 1;
    state.workflow.phase = "interviewing";
    state.workflow.active_section_id = "audience_understanding";
    state.workflow.transition_allowed = false;
    state.workflow.pending_review_section_id = null;

    const response = await generateAssistantResponse({
      state,
      userMessage: "Business leaders are our audience.",
      nextQuestion:
        "Who exactly do you want to attract on LinkedIn from this audience?",
      questionType: "clarify",
      currentSectionName: "Audience Understanding",
      workflowState: state.workflow,
    });

    expect(response).toContain("We're still in Audience Understanding.");
    expect(response.toLowerCase()).not.toContain("let's move");
    expect(response.toLowerCase()).not.toContain("completes the audience");
  });
});
