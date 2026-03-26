import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { generateExampleAnswers } from "@/server/askmore_v2/services/example-answer-generator";

beforeEach(() => {
  generateModelObjectMock.mockReset();
});

describe("askmore v2 example answer generator", () => {
  test("filters off-domain examples and falls back to question-aligned templates", async () => {
    generateModelObjectMock.mockResolvedValue({
      example_answers: [
        "猫咪尿里有血丝，而且尿频。",
        "我家猫咪最近尿血，排尿次数变少。",
        "我不确定是发炎还是结石。",
      ],
    });

    const examples = await generateExampleAnswers({
      language: "zh",
      question: "请详细描述猫咪过度舔毛导致的皮肤病变特征",
      scenario: "宠物问诊",
      targetOutputType: "结构化总结",
      knownContext: ["q3__skin_lesion: 背上有几块掉毛"],
      gapHints: ["皮肤病变特征", "脱毛区域形态"],
    });

    expect(examples.length).toBeGreaterThanOrEqual(3);
    expect(examples.some((item) => /皮肤|舔毛|脱毛/.test(item))).toBe(true);
    expect(examples.some((item) => /尿血/.test(item))).toBe(false);
  });

  test("keeps relevant examples from model output", async () => {
    generateModelObjectMock.mockResolvedValue({
      example_answers: [
        "主要是背上有几块局部掉毛，边缘有点发红。",
        "舔毛最厉害的是后腿内侧，最近两周更明显。",
        "我不太确定是不是皮肤病，但掉毛区域在慢慢扩大。",
      ],
    });

    const examples = await generateExampleAnswers({
      language: "zh",
      question: "请详细描述猫咪过度舔毛导致的皮肤病变特征",
      scenario: "宠物问诊",
      targetOutputType: "结构化总结",
      knownContext: [],
      gapHints: ["皮肤病变特征"],
    });

    expect(examples.length).toBeGreaterThanOrEqual(2);
    expect(examples.every((item) => /皮肤|舔毛|掉毛|区域|发红/.test(item))).toBe(true);
  });
});
