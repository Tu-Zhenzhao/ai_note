import { beforeEach, describe, expect, test, vi } from "vitest";
import { createInitialState, statusValue } from "@/lib/state";
import { composePreview } from "@/server/services/preview";
import {
  getPreviewFocusKey,
  getSectionVisualState,
} from "@/components/interview-review-state";

const { mockGetState, mockPersistStateAndSession } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockPersistStateAndSession: vi.fn(),
}));

vi.mock("@/server/repo", () => ({
  getInterviewRepository: () => ({
    getState: mockGetState,
  }),
}));

vi.mock("@/server/services/persistence", () => ({
  persistStateAndSession: mockPersistStateAndSession,
}));

import { POST as editPreviewPost } from "../app/api/interview/preview/edit/route";

describe("confirmation flow regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("company summary shows confirmed badge when slot was explicitly confirmed", () => {
    const state = createInitialState("confirm-badge");
    state.company_profile.company_one_liner = statusValue(
      "Ultrafilter is a search API for unstructured data.",
      "verified",
      false,
      "user_confirmed",
    );
    state.company_profile.industry = statusValue(["AI infrastructure"], "strong");
    state.company_profile.business_model = statusValue(["service"], "strong");
    state.system_assessment.confirmed_slot_ids = [
      "company_understanding.company_summary",
    ];

    const preview = composePreview(state) as any;
    const summaryBadge = preview.sections.company_understanding.verification.find(
      (indicator: { label: string; state: string }) =>
        indicator.label === "Company summary",
    );

    expect(summaryBadge?.state).toBe("confirmed_by_user");
    expect(
      preview.internal_preview.preview_slots.find(
        (slot: { id: string; verification_state: string }) =>
          slot.id === "company_understanding.company_summary",
      )?.verification_state,
    ).toBe("user_confirmed");
  });

  test("confirming state keeps preview focus on reviewed section", () => {
    expect(
      getPreviewFocusKey(
        "Audience Understanding",
        "company_understanding",
      ),
    ).toBe("company_understanding");

    const companyState = getSectionVisualState(
      "company_understanding",
      "Audience Understanding",
      "company_understanding",
    );
    const audienceState = getSectionVisualState(
      "audience_understanding",
      "Audience Understanding",
      "company_understanding",
    );

    expect(companyState.isConfirming).toBe(true);
    expect(companyState.isActive).toBe(false);
    expect(audienceState.isActive).toBe(false);
  });

  test("suggest-change edit path saves direct value without rewrite", async () => {
    const state = createInitialState("direct-edit");
    mockGetState.mockResolvedValue({ state_jsonb: state });
    mockPersistStateAndSession.mockResolvedValue(undefined);

    const directText = "Direct user edit: keep this exact sentence.";
    const request = new Request("http://localhost/api/interview/preview/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "direct-edit",
        section_id: "company_understanding",
        edited_content: { company_summary: directText },
      }),
    });

    const response = await editPreviewPost(request as any);
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(state.company_profile.company_one_liner.value).toBe(directText);
    expect(state.system_assessment.confirmed_slot_ids).toContain(
      "company_understanding.company_summary",
    );
    expect(payload.updated_preview.sections.company_understanding.company_summary).toContain(
      directText,
    );
  });
});
