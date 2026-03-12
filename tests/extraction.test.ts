import { describe, expect, test } from "vitest";
import { createInitialState } from "@/lib/state";
import { extractStructuredUpdates } from "@/server/services/extraction";

describe("extraction quality", () => {
  test("short contrast answers map to business model", async () => {
    const state = createInitialState("ext-1");
    state.conversation_meta.current_focus_modules = ["company_profile"];

    await extractStructuredUpdates({
      state,
      userMessage: "B) service",
      sourceTurnId: "turn-1",
    });

    expect(state.company_profile.business_model.value).toContain("service");
    expect(state.system_assessment.last_turn_diagnostics.captured_fields_this_turn).toContain(
      "company_profile.business_model",
    );
  });

  test("one message can update multiple fields in one turn", async () => {
    const state = createInitialState("ext-2");
    const message =
      "We provide software APIs for enterprise search. Goal is to attract inbound leads. Tone should be analytical, practical.";

    await extractStructuredUpdates({
      state,
      userMessage: message,
      sourceTurnId: "turn-2",
    });

    expect(state.company_profile.company_one_liner.value.length).toBeGreaterThan(0);
    expect(state.company_profile.business_model.value.length).toBeGreaterThan(0);
    expect(state.linkedin_content_strategy.primary_content_goal.value.length).toBeGreaterThan(0);
    expect(state.content_preferences.preferred_tone.value.length).toBeGreaterThan(0);
  });

  test("contradictory business model answers create pending conflict", async () => {
    const state = createInitialState("ext-3");
    state.company_profile.business_model.value = ["software"];
    state.company_profile.business_model.status = "strong";

    await extractStructuredUpdates({
      state,
      userMessage: "We are a managed service",
      sourceTurnId: "turn-3",
    });

    expect(state.system_assessment.pending_conflicts.some((item) => item.field === "company_profile.business_model")).toBe(
      true,
    );
    expect(state.system_assessment.last_turn_diagnostics.conflicts_detected).toContain(
      "company_profile.business_model",
    );
  });
});
