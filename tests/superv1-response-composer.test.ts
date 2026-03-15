import { describe, expect, test, vi } from "vitest";
import { composeResponse } from "@/server/superv1/services/response-composer";
import { getLocalizedQuestionGuidance } from "@/server/superv1/question-guidance";

const { generateModelTextMock } = vi.hoisted(() => ({
  generateModelTextMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelText: generateModelTextMock,
}));

describe("superv1 response composer", () => {
  test("ask_for_help fallback includes question guidance options and known business context", async () => {
    generateModelTextMock.mockRejectedValueOnce(new Error("model unavailable"));

    const reply = await composeResponse({
      intent: "ask_for_help",
      language: "zh",
      acceptedFacts: [],
      planner: {
        active_section_id: "audience_understanding",
        next_question_id: "ma_primary_audience",
        next_question_text: "你的产品主要面向哪些用户群体？",
        ask_count: 3,
        clarification_required: false,
        unresolved_required_question_ids: ["ma_primary_audience"],
      },
      userMessage: "有哪些用户群体呀？如何分类呢？",
      interactionMode: "help_open",
      isHelpContinuation: true,
      helpContext: {
        question_id: "ma_primary_audience",
        question_text: "你的产品主要面向哪些用户群体？",
        help_menu_version: 2,
        last_help_options: [],
      },
      detectedHelpSelection: null,
      currentQuestionText: "你的产品主要面向哪些用户群体？",
      currentQuestionGuidance: getLocalizedQuestionGuidance("ma_primary_audience", "zh"),
      knownBusinessContext: ["What category does it belong to?: API 服务类别"],
    });

    expect(reply).toContain("可参考类别");
    expect(reply).toContain("企业知识管理团队");
    expect(reply).toContain("已知上下文");
    expect(reply).toContain("API 服务类别");
  });
});
