import { describe, expect, test } from "vitest";
import { compileQuestionNodes } from "@/server/askmore_v2/services/node-compiler";

describe("askmore v2 node compiler", () => {
  test("builds nodes from final flow questions", async () => {
    const nodes = await compileQuestionNodes({
      language: "zh",
      scenario: "咨询",
      targetOutputType: "总结",
      questions: [
        {
          question_id: "q1",
          original_question: "原题1",
          source_mode: "use_ai_refined",
          entry_question: "入口1",
          sub_questions: ["子问1", "子问2"],
          example_answer_styles: ["一句话版"],
          recommended_strategy: "progressive_expand",
        },
      ],
    });

    expect(nodes.q1.question_id).toBe("q1");
    expect(nodes.q1.target_dimensions.length).toBe(2);
    expect(nodes.q1.target_dimensions.some((item) => /^d\d+$/i.test(item.id))).toBe(false);
    expect(nodes.q1.completion_criteria.length).toBeGreaterThan(0);
    expect(nodes.q1.user_facing_entry).toBe("入口1");
  });

  test("uses fallback dimension when sub_questions is empty", async () => {
    const nodes = await compileQuestionNodes({
      language: "zh",
      scenario: "咨询",
      targetOutputType: "总结",
      questions: [
        {
          question_id: "q1",
          original_question: "原题1",
          source_mode: "use_original",
          entry_question: "入口1",
          sub_questions: [],
          example_answer_styles: ["一句话版"],
          recommended_strategy: "keep_original_with_ai_support",
        },
      ],
    });

    expect(nodes.q1.target_dimensions.length).toBe(1);
    expect(nodes.q1.target_dimensions[0].id).toBe("core_observation");
  });
});
