import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { planDialogueStep } from "@/server/askmore_v2/services/dialogue-planner";

const currentNode = {
  question_id: "q1",
  goal: "test",
  user_facing_entry: "入口",
  target_dimensions: [
    { id: "d1", label: "维度1" },
    { id: "d2", label: "维度2" },
  ],
  completion_criteria: ["d1", "d2"],
  hypothesis_templates: ["h1"],
  node_summary_template: "tpl",
} as const;

beforeEach(() => {
  generateModelObjectMock.mockReset();
});

describe("askmore v2 dialogue planner", () => {
  test("fallback chooses clarify when key dimension missing", async () => {
    generateModelObjectMock.mockRejectedValue(new Error("boom"));

    const result = await planDialogueStep({
      language: "zh",
      currentNode,
      nodeState: {
        question_id: "q1",
        captured_dimensions: { d1: "x" },
        dimension_confidence: { d1: 0.8, d2: 0.2 },
        dimension_soft_confidence: { d1: 0.8, d2: 0.2 },
        dimension_answered: { d1: true, d2: false },
        dimension_answered_evidence: { d1: "x" },
        dimension_micro_confirmed: { d1: true, d2: false },
        clarify_count: 0,
        node_status: "partial",
        candidate_hypothesis: null,
        last_node_summary: null,
        contradiction_detected: false,
        last_micro_confirm_offer: null,
      },
      extractorResult: {
        facts_extracted: {
          d1: { value: "x", evidence: "x", confidence: 0.8 },
        },
        updated_dimensions: ["d1"],
        missing_dimensions: ["d2"],
        answer_quality: "usable",
        user_effort_signal: "normal",
        contradiction_detected: false,
        candidate_hypothesis: "partial",
        confidence_overall: 0.6,
      },
      interviewState: {
        turn_count: 1,
        total_questions: 3,
        completed_questions: 0,
        pending_end_confirmation: false,
        progressive_summary_available: false,
      },
    });

    expect(result.planner_action).toBe("micro_confirm_then_clarify");
    expect(result.chosen_dimension_to_ask).toBe("d2");
    expect(result.dimension_priority_map.d1).toBe("must");
    expect(result.dimension_priority_map.d2).toBe("must");
    expect(result.must_dimensions.sort()).toEqual(["d1", "d2"]);
    expect(result.optional_dimensions).toEqual([]);
  });

  test("fallback wraps up node when required dimensions covered", async () => {
    generateModelObjectMock.mockRejectedValue(new Error("boom"));

    const result = await planDialogueStep({
      language: "zh",
      currentNode,
      nodeState: {
        question_id: "q1",
        captured_dimensions: { d1: "x", d2: "y" },
        dimension_confidence: { d1: 0.84, d2: 0.81 },
        dimension_soft_confidence: { d1: 0.84, d2: 0.81 },
        dimension_answered: { d1: true, d2: true },
        dimension_answered_evidence: { d1: "x", d2: "y" },
        dimension_micro_confirmed: { d1: true, d2: true },
        clarify_count: 0,
        node_status: "partial",
        candidate_hypothesis: null,
        last_node_summary: null,
        contradiction_detected: false,
        last_micro_confirm_offer: null,
      },
      extractorResult: {
        facts_extracted: {
          d2: { value: "y", evidence: "y", confidence: 0.81 },
        },
        updated_dimensions: ["d2"],
        missing_dimensions: [],
        answer_quality: "clear",
        user_effort_signal: "normal",
        contradiction_detected: false,
        candidate_hypothesis: "done",
        confidence_overall: 0.9,
      },
      interviewState: {
        turn_count: 2,
        total_questions: 3,
        completed_questions: 1,
        pending_end_confirmation: false,
        progressive_summary_available: false,
      },
    });

    expect(["node_wrap_up", "offer_early_summary", "end_interview"]).toContain(result.planner_action);
    expect(result.node_status).toBe("complete");
    expect(result.progress_signal.covered_count).toBeGreaterThanOrEqual(2);
  });

  test("normalizes planner priority output to cover all dimensions exactly once", async () => {
    generateModelObjectMock.mockResolvedValue({
      node_status: "partial",
      planner_action: "micro_confirm_then_clarify",
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
        node_readiness: 0.55,
        interview_readiness: 0.4,
      },
      planner_notes: {
        reason_short: "partial",
        missing_priority: ["d1"],
      },
      dimension_priority_map: {
        d1: "optional",
      },
      must_dimensions: [],
      optional_dimensions: ["d1"],
    });

    const result = await planDialogueStep({
      language: "zh",
      currentNode,
      nodeState: {
        question_id: "q1",
        captured_dimensions: {},
        dimension_confidence: {},
        dimension_soft_confidence: {},
        dimension_answered: {},
        dimension_answered_evidence: {},
        dimension_micro_confirmed: {},
        clarify_count: 0,
        node_status: "not_started",
        candidate_hypothesis: null,
        last_node_summary: null,
        contradiction_detected: false,
        last_micro_confirm_offer: null,
      },
      extractorResult: {
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: ["d1", "d2"],
        unanswered_dimensions: ["d1", "d2"],
        answer_quality: "usable",
        user_effort_signal: "normal",
        contradiction_detected: false,
        candidate_hypothesis: "partial",
        confidence_overall: 0.5,
      },
      interviewState: {
        turn_count: 1,
        total_questions: 3,
        completed_questions: 0,
        pending_end_confirmation: false,
        progressive_summary_available: false,
      },
    });

    const covered = [...result.must_dimensions, ...result.optional_dimensions].sort();
    expect(covered).toEqual(["d1", "d2"]);
    expect(new Set(covered).size).toBe(2);
    expect(Object.keys(result.dimension_priority_map).sort()).toEqual(["d1", "d2"]);
    expect(result.dimension_priority_map.d1).toBe("optional");
    expect(result.dimension_priority_map.d2).toBe("must");
  });
});
