import { describe, expect, test } from "vitest";
import {
  detectQuestionAlignedAnswer,
  getLocalizedQuestionGuidance,
  getQuestionGuidance,
} from "@/server/superv1/question-guidance";

describe("superv1 question guidance", () => {
  test("loads localized cp_category guidance", () => {
    const zh = getLocalizedQuestionGuidance("cp_category", "zh");
    const en = getLocalizedQuestionGuidance("cp_category", "en");

    expect(zh?.question_id).toBe("cp_category");
    expect(zh?.canonical_options.length).toBeGreaterThan(3);
    expect(zh?.canonical_options.join(" ")).toContain("开发者 API 服务工具");
    expect(en?.canonical_options.join(" ")).toContain("Developer API service tool");
  });

  test("loads localized ma_primary_audience guidance", () => {
    const zh = getLocalizedQuestionGuidance("ma_primary_audience", "zh");
    const en = getLocalizedQuestionGuidance("ma_primary_audience", "en");

    expect(zh?.question_id).toBe("ma_primary_audience");
    expect(zh?.canonical_options.join(" ")).toContain("企业知识管理团队");
    expect(en?.canonical_options.join(" ")).toContain("AI application development teams");
  });

  test("detects slot-aligned category answer signals", () => {
    const positive = detectQuestionAlignedAnswer({
      questionId: "cp_category",
      message: "那我们属于api服务类别，针对企业用户",
    });
    const negative = detectQuestionAlignedAnswer({
      questionId: "cp_category",
      message: "我不太明白这个问题，能解释一下吗？",
    });
    const missing = getQuestionGuidance("unknown_question");
    const audiencePositive = detectQuestionAlignedAnswer({
      questionId: "ma_primary_audience",
      message: "我们主要面向企业 IT 与知识库运营团队",
    });
    const audienceHelpLike = detectQuestionAlignedAnswer({
      questionId: "ma_primary_audience",
      message: "有哪些用户群体呀？如何分类呢？",
    });

    expect(positive).toBe(true);
    expect(negative).toBe(false);
    expect(audiencePositive).toBe(true);
    expect(audienceHelpLike).toBe(false);
    expect(missing).toBeNull();
  });
});
