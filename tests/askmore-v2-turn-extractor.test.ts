import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { extractTurnFacts } from "@/server/askmore_v2/services/turn-extractor";

const currentNode = {
  question_id: "q1",
  goal: "test",
  user_facing_entry: "入口",
  target_dimensions: [
    { id: "posture", label: "排尿姿势" },
    { id: "pain_signs", label: "不适表现" },
  ],
  completion_criteria: ["posture", "pain_signs"],
  hypothesis_templates: ["h1"],
  node_summary_template: "tpl",
} as const;

const nodeState = {
  question_id: "q1",
  captured_dimensions: {},
  dimension_confidence: { posture: 0.1, pain_signs: 0.1 },
  dimension_soft_confidence: { posture: 0.1, pain_signs: 0.1 },
  dimension_answered: { posture: false, pain_signs: false },
  dimension_answered_evidence: {},
  dimension_micro_confirmed: { posture: false, pain_signs: false },
  clarify_count: 0,
  node_status: "not_started" as const,
  candidate_hypothesis: null,
  last_node_summary: null,
  contradiction_detected: false,
  last_micro_confirm_offer: null,
};

beforeEach(() => {
  generateModelObjectMock.mockReset();
});

describe("askmore v2 turn extractor", () => {
  test("fallback returns usable structure when model fails", async () => {
    generateModelObjectMock.mockRejectedValue(new Error("boom"));

    const result = await extractTurnFacts({
      language: "zh",
      currentNode,
      nodeState,
      userMessage: "它会喷一点点，而且会舔那里",
    });

    expect(result.answer_quality).toBe("usable");
    expect(result.updated_dimensions.length).toBeGreaterThan(0);
    expect(Array.isArray(result.missing_dimensions)).toBe(true);
    expect(result.confidence_overall).toBeGreaterThanOrEqual(0);
    expect(result.confidence_overall).toBeLessThanOrEqual(1);
  });

  test("filters out dimensions not defined in target_dimensions", async () => {
    generateModelObjectMock.mockResolvedValue({
      facts_extracted: {
        posture: {
          value: "value-1",
          evidence: "evidence-1",
          confidence: 0.8,
        },
        unknown_field: {
          value: "value-x",
          evidence: "evidence-x",
          confidence: 0.9,
        },
      },
      updated_dimensions: ["posture", "unknown_field"],
      missing_dimensions: ["pain_signs"],
      answer_quality: "clear",
      user_effort_signal: "normal",
      contradiction_detected: false,
      candidate_hypothesis: "test",
      confidence_overall: 0.7,
    });

    const result = await extractTurnFacts({
      language: "zh",
      currentNode,
      nodeState,
      userMessage: "test",
    });

    expect(result.facts_extracted.posture.value).toBe("value-1");
    expect(result.facts_extracted.unknown_field).toBeUndefined();
    expect(result.updated_dimensions).toEqual(["posture"]);
  });

  test("maps alias keys to canonical dimension ids", async () => {
    generateModelObjectMock.mockResolvedValue({
      facts_extracted: {
        discomfort: {
          value: "会舔那里",
          evidence: "会舔那里",
          confidence: 0.74,
        },
      },
      updated_dimensions: ["discomfort"],
      missing_dimensions: ["posture"],
      answer_quality: "usable",
      user_effort_signal: "normal",
      contradiction_detected: false,
      candidate_hypothesis: "partial",
      confidence_overall: 0.5,
    });

    const result = await extractTurnFacts({
      language: "zh",
      currentNode,
      nodeState,
      userMessage: "会舔那里",
    });

    expect(result.facts_extracted.pain_signs?.value).toBe("会舔那里");
    expect(result.normalization_hits?.includes("discomfort")).toBe(true);
  });

  test("maps temporal alias keys to onset_timing when dimension exists", async () => {
    const temporalNode = {
      ...currentNode,
      target_dimensions: [
        { id: "onset_timing", label: "开始时机" },
        { id: "pain_signs", label: "不适表现" },
      ],
      completion_criteria: ["onset_timing", "pain_signs"],
    } as const;

    generateModelObjectMock.mockResolvedValue({
      facts_extracted: {
        start_time: {
          value: "最近才开始",
          evidence: "最近才开始",
          confidence: 0.62,
        },
      },
      updated_dimensions: ["start_time"],
      missing_dimensions: ["pain_signs"],
      answer_quality: "usable",
      user_effort_signal: "normal",
      contradiction_detected: false,
      candidate_hypothesis: "partial",
      confidence_overall: 0.58,
    });

    const result = await extractTurnFacts({
      language: "zh",
      currentNode: temporalNode,
      nodeState: {
        ...nodeState,
        dimension_confidence: { onset_timing: 0.1, pain_signs: 0.1 },
      },
      userMessage: "最近才开始",
    });

    expect(result.facts_extracted.onset_timing?.value).toBe("最近才开始");
    expect(result.normalization_hits?.includes("start_time")).toBe(true);
  });

  test("maps chinese frequency alias key to canonical frequency dimension", async () => {
    const frequencyNode = {
      ...currentNode,
      target_dimensions: [
        { id: "frequency", label: "乱尿的频率是多少（每周几次）？" },
        { id: "urination_location", label: "排泄物的位置分布" },
      ],
      completion_criteria: ["frequency", "urination_location"],
    } as const;

    generateModelObjectMock.mockResolvedValue({
      facts_extracted: {
        频率: {
          value: "一周三四次",
          evidence: "一周三四次",
          confidence: 0.8,
        },
      },
      updated_dimensions: ["频率"],
      missing_dimensions: ["urination_location"],
      answer_quality: "usable",
      user_effort_signal: "normal",
      contradiction_detected: false,
      candidate_hypothesis: "partial",
      confidence_overall: 0.6,
    });

    const result = await extractTurnFacts({
      language: "zh",
      currentNode: frequencyNode,
      nodeState: {
        ...nodeState,
        dimension_confidence: {
          frequency: 0.1,
          urination_location: 0.1,
        },
      },
      userMessage: "一周三四次吧",
    });

    expect(result.facts_extracted.frequency?.value).toBe("一周三四次");
    expect(result.updated_dimensions).toContain("frequency");
    expect(result.normalization_hits?.includes("频率")).toBe(true);
  });

  test("uses mention-signal fallback when model returns no normalized facts", async () => {
    const frequencyNode = {
      ...currentNode,
      target_dimensions: [
        { id: "frequency", label: "乱尿的频率是多少（每周几次）？" },
        { id: "urination_location", label: "排泄物的位置分布" },
      ],
      completion_criteria: ["frequency", "urination_location"],
    } as const;

    generateModelObjectMock.mockResolvedValue({
      facts_extracted: {},
      updated_dimensions: [],
      missing_dimensions: ["frequency", "urination_location"],
      answer_quality: "usable",
      user_effort_signal: "normal",
      contradiction_detected: false,
      candidate_hypothesis: "partial",
      confidence_overall: 0.2,
    });

    const result = await extractTurnFacts({
      language: "zh",
      currentNode: frequencyNode,
      nodeState: {
        ...nodeState,
        dimension_confidence: {
          frequency: 0.1,
          urination_location: 0.1,
        },
      },
      userMessage: "一周三四次吧",
    });

    expect(result.facts_extracted.frequency?.value).toContain("一周三四次");
    expect(result.facts_extracted.frequency?.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.updated_dimensions).toContain("frequency");
  });

  test("uses hint-dimension fallback when model marks short answer as off_topic", async () => {
    const frequencyNode = {
      ...currentNode,
      target_dimensions: [
        { id: "frequency", label: "乱尿的频率是多少（每周几次）？" },
        { id: "urination_location", label: "排泄物的位置分布" },
      ],
      completion_criteria: ["frequency", "urination_location"],
    } as const;

    generateModelObjectMock.mockResolvedValue({
      facts_extracted: {},
      updated_dimensions: [],
      missing_dimensions: ["frequency", "urination_location"],
      answer_quality: "off_topic",
      user_effort_signal: "low",
      contradiction_detected: false,
      candidate_hypothesis: "none",
      confidence_overall: 0.1,
    });

    const result = await extractTurnFacts({
      language: "zh",
      currentNode: frequencyNode,
      nodeState: {
        ...nodeState,
        dimension_confidence: {
          frequency: 0.1,
          urination_location: 0.1,
        },
      },
      userMessage: "一周三四次吧",
      hintDimensionId: "frequency",
    });

    expect(result.facts_extracted.frequency?.value).toBe("一周三四次吧");
    expect(result.facts_extracted.frequency?.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.updated_dimensions).toContain("frequency");
  });

  test("does not treat clarification question as answered even with hint", async () => {
    const frequencyNode = {
      ...currentNode,
      target_dimensions: [
        { id: "frequency", label: "乱尿的频率是多少（每周几次）？" },
        { id: "urination_location", label: "排泄物的位置分布" },
      ],
      completion_criteria: ["frequency", "urination_location"],
    } as const;

    generateModelObjectMock.mockResolvedValue({
      facts_extracted: {},
      updated_dimensions: [],
      missing_dimensions: ["frequency", "urination_location"],
      answer_quality: "off_topic",
      user_effort_signal: "normal",
      contradiction_detected: false,
      candidate_hypothesis: "none",
      confidence_overall: 0.1,
    });

    const result = await extractTurnFacts({
      language: "zh",
      currentNode: frequencyNode,
      nodeState: {
        ...nodeState,
        dimension_confidence: {
          frequency: 0.1,
          urination_location: 0.1,
        },
      },
      userMessage: "你问的是乱尿几次还是尿尿几次？",
      hintDimensionId: "frequency",
    });

    expect(Object.keys(result.facts_extracted)).toHaveLength(0);
    expect(result.updated_dimensions).toHaveLength(0);
  });
});
