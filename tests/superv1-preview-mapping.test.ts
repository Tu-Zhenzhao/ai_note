import { describe, expect, test } from "vitest";
import { buildPreviewFromSuperV1State } from "@/lib/superv1-preview";

describe("superv1 preview mapping", () => {
  test("maps filled answers into six-section preview shape", () => {
    const preview = buildPreviewFromSuperV1State({
      answers: [
        {
          question_id: "cp_what_does_company_do",
          status: "filled",
          value: "We help B2B SaaS teams turn product launches into narrative content.",
          confidence: 0.84,
          evidence_text: "We help B2B SaaS teams turn product launches into narrative content.",
        },
        {
          question_id: "ps_main_offering",
          status: "confirmed",
          value: "Content strategy sprint",
          confidence: 0.88,
          evidence_text: "Content strategy sprint",
        },
        {
          question_id: "ma_primary_audience",
          status: "filled",
          value: "Product marketing leaders",
          confidence: 0.8,
          evidence_text: "Product marketing leaders",
        },
        {
          question_id: "lcs_what_achieve",
          status: "filled",
          value: "Build authority and generate inbound demo requests",
          confidence: 0.8,
          evidence_text: "Build authority and generate inbound demo requests",
        },
        {
          question_id: "cr_first_topic",
          status: "filled",
          value: "How to launch a feature without message drift",
          confidence: 0.8,
          evidence_text: "How to launch a feature without message drift",
        },
        {
          question_id: "cr_first_format",
          status: "filled",
          value: "LinkedIn carousel",
          confidence: 0.8,
          evidence_text: "LinkedIn carousel",
        },
      ],
    });

    const sections = preview.sections as Record<string, Record<string, unknown>>;
    expect(sections.company_understanding.company_summary).toContain("B2B SaaS");
    expect(sections.company_understanding.main_offering).toBe("Content strategy sprint");
    expect(sections.audience_understanding.primary_audience).toBe("Product marketing leaders");
    expect(sections.linkedin_content_strategy.main_content_goal).toContain("authority");
    expect(sections.generation_plan.planned_first_topic).toContain("feature");

    const prefs = sections.content_preferences_and_boundaries as Record<string, unknown>;
    expect(prefs).toBeDefined();

    const internal = preview.internal_preview as Record<string, unknown>;
    const slots = internal.preview_slots as Array<Record<string, unknown>>;
    const offeringSlot = slots.find((slot) => slot.id === "ps_main_offering");
    expect(offeringSlot?.verification_state).toBe("confirmed_by_user");
  });
});
