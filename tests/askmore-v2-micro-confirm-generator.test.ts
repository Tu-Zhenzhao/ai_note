import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { generateMicroConfirmation } from "@/server/askmore_v2/services/micro-confirm-generator";

beforeEach(() => {
  generateModelObjectMock.mockReset();
});

describe("askmore v2 micro confirm generator", () => {
  test("enforces temporal options for onset_timing even when model returns location options", async () => {
    generateModelObjectMock.mockResolvedValue({
      ack_text: "确认一下",
      options: [
        { option_id: "A", label: "就在猫砂盆内", normalized_value: "inside_litter_box" },
        { option_id: "B", label: "猫砂盆外", normalized_value: "outside_litter_box" },
        { option_id: "C", label: "在床上", normalized_value: "on_bed" },
      ],
      allow_free_text: true,
    });

    const result = await generateMicroConfirmation({
      language: "zh",
      dimensionId: "onset_timing",
      dimensionLabel: "开始时机",
      userEvidence: "最近才开始",
      candidateValue: null,
      unresolvedReason: "ambiguous_temporal",
    });

    expect(result.options.some((item) => /几天|几周|几个月|一直以来/.test(item.label))).toBe(true);
    expect(result.options.some((item) => /猫砂盆|床|衣物/.test(item.label))).toBe(false);
  });

  test("enforces location options for location dimension even when model returns temporal options", async () => {
    generateModelObjectMock.mockResolvedValue({
      ack_text: "确认一下",
      options: [
        { option_id: "A", label: "最近几天才开始", normalized_value: "started_recent_days" },
        { option_id: "B", label: "最近几周开始", normalized_value: "started_recent_weeks" },
        { option_id: "C", label: "一直以来都有", normalized_value: "longstanding" },
      ],
      allow_free_text: true,
    });

    const result = await generateMicroConfirmation({
      language: "zh",
      dimensionId: "urination_location",
      dimensionLabel: "排尿位置",
      userEvidence: "主要在猫砂盆旁边",
      candidateValue: null,
      unresolvedReason: "semantic_unmapped",
    });

    expect(result.options.some((item) => /猫砂盆|床|衣物|软织物/.test(item.label))).toBe(true);
    expect(result.options.some((item) => /最近几天|最近几周|一直以来/.test(item.label))).toBe(false);
  });

  test("ack_text is upgraded to explanatory style (acknowledge + reason + one-tap)", async () => {
    generateModelObjectMock.mockResolvedValue({
      ack_text: "确认一下",
      options: [
        { option_id: "A", label: "最近几天才开始", normalized_value: "started_recent_days" },
        { option_id: "B", label: "最近几周开始", normalized_value: "started_recent_weeks" },
        { option_id: "C", label: "一直以来都有", normalized_value: "longstanding" },
      ],
      allow_free_text: true,
    });

    const result = await generateMicroConfirmation({
      language: "zh",
      dimensionId: "onset_timing",
      dimensionLabel: "开始时机",
      userEvidence: "最近开始的",
      candidateValue: null,
      unresolvedReason: "ambiguous_temporal",
    });

    expect(result.ack_text).toContain("回答很有帮助");
    expect(result.ack_text).toContain("为了记录更精确");
    expect(result.ack_text).toContain("点一下最接近的选项");
  });
});
