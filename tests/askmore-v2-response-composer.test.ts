import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { composeTurnResponse } from "@/server/askmore_v2/services/response-composer";

const commonParams = {
  language: "zh" as const,
  currentNode: {
    question_id: "q1",
    goal: "test",
    user_facing_entry: "入口",
    target_dimensions: [{ id: "d1", label: "维度1" }],
    completion_criteria: ["d1"],
    hypothesis_templates: ["h1"],
    node_summary_template: "tpl",
  },
  extractorResult: {
    facts_extracted: {
      d1: {
        value: "会喷尿",
        evidence: "用户说会喷尿",
        confidence: 0.82,
      },
    },
    updated_dimensions: ["d1"],
    missing_dimensions: [],
    answer_quality: "usable" as const,
    user_effort_signal: "normal" as const,
    contradiction_detected: false,
    candidate_hypothesis: "partial",
    confidence_overall: 0.7,
  },
  plannerResult: {
    node_status: "partial" as const,
    planner_action: "micro_confirm_then_clarify" as const,
    chosen_dimension_to_ask: "d1",
    should_show_micro_confirmation: true,
    should_use_hypothesis_style: false,
    should_show_node_summary: false,
    should_offer_early_summary: false,
    progress_signal: {
      covered_count: 1,
      required_count: 2,
      remaining_count: 1,
    },
    readiness: {
      node_readiness: 0.5,
      interview_readiness: 0.4,
    },
    planner_notes: {
      reason_short: "x",
      missing_priority: ["d1"],
    },
  },
  nextQuestionText: "下一问",
  nodeSummaryText: null,
};

beforeEach(() => {
  generateModelObjectMock.mockReset();
});

describe("askmore v2 response composer", () => {
  test("fallback returns conversational blocks when model fails", async () => {
    generateModelObjectMock.mockRejectedValue(new Error("boom"));

    const result = await composeTurnResponse(commonParams);

    expect(Array.isArray(result.response_blocks)).toBe(true);
    expect(result.response_blocks.some((block) => block.type === "understanding")).toBe(true);
    expect(result.response_blocks.some((block) => block.type === "next_question")).toBe(true);
  });

  test("sanitizes model output and keeps non-empty blocks", async () => {
    generateModelObjectMock.mockResolvedValue({
      response_blocks: [
        { type: "understanding", content: "  已理解  " },
        { type: "next_question", content: "  " },
        { type: "example_answers", items: ["  示例A  ", "", "示例B"] },
      ],
    });

    const result = await composeTurnResponse(commonParams);

    expect(result.response_blocks.find((block) => block.type === "understanding")?.content).toBe("已理解");
    expect(result.response_blocks.find((block) => block.type === "next_question")).toBeUndefined();
    expect(result.response_blocks.find((block) => block.type === "example_answers")?.items).toEqual(["示例A", "示例B"]);
  });
});
