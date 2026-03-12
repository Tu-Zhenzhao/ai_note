import { describe, expect, test } from "vitest";
import { createInitialState } from "@/lib/state";
import { generateAssistantResponse } from "@/server/services/assistant";

describe("assistant turn contract", () => {
  test("response contains acknowledge, synthesis, progress, and one focused question", async () => {
    const state = createInitialState("asst-1");
    state.system_assessment.last_turn_diagnostics.captured_fields_this_turn = ["company_profile.company_one_liner"];
    const response = await generateAssistantResponse({
      state,
      userMessage: "We provide indexing APIs.",
      nextQuestion: "What is your main LinkedIn goal? Also what format do you prefer?",
      questionType: "clarify",
      questionStyle: "reflect_and_advance",
      userFacingProgressNote: "Good progress. I captured a new detail.",
    });

    expect(response.length).toBeGreaterThan(20);
    expect(response.split("?").length - 1).toBeLessThanOrEqual(1);
  });

  test("assistant text does not expose schema keys", async () => {
    const state = createInitialState("asst-2");
    const response = await generateAssistantResponse({
      state,
      userMessage: "B) service",
      nextQuestion: "Confirm company_profile.business_model?",
      questionType: "confirm",
      questionStyle: "synthesize_and_confirm",
      userFacingProgressNote: "Captured company_profile.business_model.",
    });

    expect(response).not.toContain("company_profile.business_model");
  });
});
