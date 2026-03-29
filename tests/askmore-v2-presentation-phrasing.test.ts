import { describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { phrasePresentationEvents } from "@/server/askmore_v2/presentation/phrasing-helper";

describe("askmore v2 presentation phrasing", () => {
  test("completion closure transition uses template output and never falls back to continue style", async () => {
    generateModelObjectMock.mockReset();

    const events = await phrasePresentationEvents({
      language: "zh",
      toneProfile: "medical_pet",
      reasoningProfile: "medical_pet",
      safeBoundary: {
        id: "medical_pet",
        enforce_uncertainty: true,
        forbid_definitive_diagnosis: true,
        forbid_overpromise: true,
      },
      routedIntent: {
        intent: "answer_question",
        confidence: 0.95,
      },
      latestUserTurn: "最近猫咪血尿",
      activeQuestionText: "",
      gapHints: [],
      drafts: [
        {
          event_type: "transition",
          created_at: new Date().toISOString(),
          content_hint: "关键信息已收齐，本次访谈完成。",
          semantic_hints: {
            is_completion_closure: true,
            completion_case_summary: "根据你的描述，猫咪近期出现血尿和应激反应，关键线索已经收齐。",
            completion_domain: "pet_clinic",
          },
        },
      ],
    });

    const transition = events.find((item) => item.event_type === "transition");
    const text = String(transition?.payload.content ?? "");
    expect(text).toContain("本次健康咨询已完成。");
    expect(text).toContain("AI思考");
    expect(text).toContain("手机端");
    expect(text).toContain("重跑");
    expect(text).not.toContain("好的，我们继续");
    expect(generateModelObjectMock).not.toHaveBeenCalled();
  });
});
