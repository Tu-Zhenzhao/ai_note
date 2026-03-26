import { describe, expect, test } from "vitest";
import { generateFollowUpOptions } from "@/server/askmore_v2/services/follow-up-option-generator";

describe("askmore v2 follow-up option generator", () => {
  test("returns deterministic frequency options for frequency-like gap", async () => {
    const options = await generateFollowUpOptions({
      language: "zh",
      activeQuestionText: "请描述相关情况",
      dimensionLabel: "乱尿的频率是多少（每周几次）？",
      gapHints: ["乱尿频率"],
      userMessage: "补充一下",
    });

    expect(Array.isArray(options)).toBe(true);
    expect((options ?? []).length).toBeGreaterThanOrEqual(2);
    expect((options ?? []).length).toBeLessThanOrEqual(4);
    const labels = (options ?? []).map((item) => item.label).join(" ");
    expect(labels).toContain("不太确定");
  });

  test("uses symptom-oriented boolean options for stress symptom gap", async () => {
    const options = await generateFollowUpOptions({
      language: "zh",
      activeQuestionText: "在陌生人出现时，是否伴随明显生理应激症状？",
      dimensionLabel: "是否伴随明显的生理应激症状（如呼吸急促、流涎、腹泻或异常掉毛）？",
      gapHints: ["生理应激症状"],
      userMessage: "我再补充一点",
    });

    const labels = (options ?? []).map((item) => item.label).join(" ");
    expect(labels).toContain("症状");
    expect(labels).toContain("不太确定");
  });

  test("uses normality-oriented boolean options for eating and drinking gap", async () => {
    const options = await generateFollowUpOptions({
      language: "zh",
      activeQuestionText: "在非应激状态下，猫咪的日常进食和饮水是否正常？",
      dimensionLabel: "在非应激状态下，猫咪的日常进食和饮水是否正常？",
      gapHints: ["进食和饮水是否正常"],
      userMessage: "我再补充一点",
    });

    const labels = (options ?? []).map((item) => item.label).join(" ");
    expect(labels).toContain("正常");
    expect(labels).toContain("变化");
  });
});
