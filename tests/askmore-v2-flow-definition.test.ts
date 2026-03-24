import { describe, expect, test } from "vitest";
import {
  deriveFinalPayload,
  legacyFlowToV2,
  toCanonicalFlowDefinition,
} from "@/server/askmore_v2/flow-definition";
import { AskmoreV2LegacyFlowDefinition } from "@/server/askmore_v2/types";

describe("askmore v2 flow definition mapping", () => {
  test("deriveFinalPayload supports all 3 selection modes", () => {
    const aiCandidate = {
      entry_question: "AI 入口问题",
      sub_questions: ["AI 子问题 1", "AI 子问题 2"],
      example_answer_styles: ["一句话版", "举例版"],
      recommended_strategy: "progressive_expand",
    };

    const useOriginal = deriveFinalPayload({
      originalQuestion: "原始问题",
      aiCandidate,
      selectionMode: "use_original",
    });
    expect(useOriginal.source_mode).toBe("use_original");
    expect(useOriginal.entry_question).toBe("原始问题");
    expect(useOriginal.sub_questions).toEqual(aiCandidate.sub_questions);

    const useAi = deriveFinalPayload({
      originalQuestion: "原始问题",
      aiCandidate,
      selectionMode: "use_ai_refined",
    });
    expect(useAi.source_mode).toBe("use_ai_refined");
    expect(useAi.entry_question).toBe(aiCandidate.entry_question);

    const manual = deriveFinalPayload({
      originalQuestion: "原始问题",
      aiCandidate,
      selectionMode: "custom_manual",
      manualPayload: {
        entry_question: "手动入口",
        sub_questions: ["手动子问题"],
        example_answer_styles: ["业务描述版"],
        recommended_strategy: "manual_strategy",
      },
    });
    expect(manual.source_mode).toBe("custom_manual");
    expect(manual.entry_question).toBe("手动入口");
    expect(manual.sub_questions).toEqual(["手动子问题"]);
    expect(manual.example_answer_styles).toEqual(["业务描述版"]);
    expect(manual.recommended_strategy).toBe("manual_strategy");
  });

  test("legacy flow converts to schema_version=2 cards and final flow", () => {
    const legacyFlow: AskmoreV2LegacyFlowDefinition = {
      raw_questions: ["问题 A", "问题 B"],
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
      review_items: [
        {
          question_id: "q1",
          original_question: "问题 A",
          evaluation: {
            is_too_broad: true,
            is_too_abstract: false,
            difficulty: "medium",
          },
          reason: "偏宽",
          recommended_strategy: "progressive_expand",
          entry_question: "AI A",
          sub_questions: ["A1", "A2"],
          example_answer_styles: ["一句话版", "举例版"],
          adopted: true,
        },
        {
          question_id: "q2",
          original_question: "问题 B",
          evaluation: {
            is_too_broad: false,
            is_too_abstract: false,
            difficulty: "low",
          },
          reason: "可直接问",
          recommended_strategy: "direct_then_clarify",
          entry_question: "AI B",
          sub_questions: ["B1"],
          example_answer_styles: ["业务描述版"],
          adopted: false,
        },
      ],
    };

    const converted = legacyFlowToV2(legacyFlow);
    expect(converted.schema_version).toBe(2);
    expect(converted.cards_snapshot).toHaveLength(2);
    expect(converted.final_flow_questions).toHaveLength(2);
    expect(converted.cards_snapshot[0].selection.mode).toBe("use_ai_refined");
    expect(converted.cards_snapshot[1].selection.mode).toBe("use_original");
    expect(converted.final_flow_questions[0].entry_question).toBe("AI A");
    expect(converted.final_flow_questions[1].entry_question).toBe("问题 B");
  });

  test("toCanonicalFlowDefinition reads legacy flow without forcing republish", () => {
    const legacyFlow: AskmoreV2LegacyFlowDefinition = {
      raw_questions: ["问题 A"],
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
      review_items: [
        {
          question_id: "q1",
          original_question: "问题 A",
          evaluation: {
            is_too_broad: false,
            is_too_abstract: false,
            difficulty: "low",
          },
          reason: "可直接问",
          recommended_strategy: "direct_then_clarify",
          entry_question: "AI A",
          sub_questions: ["A1"],
          example_answer_styles: ["一句话版"],
          adopted: true,
        },
      ],
    };

    const canonical = toCanonicalFlowDefinition(legacyFlow);
    expect(canonical.schema_version).toBe(2);
    expect(canonical.cards_snapshot[0].original_question).toBe("问题 A");
    expect(canonical.final_flow_questions[0].question_id).toBe("q1");
  });
});
