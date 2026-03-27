import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { routeIntent } from "@/server/askmore_v2/runtime/intent-router";
import { RuntimeContextSnapshot } from "@/server/askmore_v2/runtime/context-engine";

function makeContext(overrides: Partial<RuntimeContextSnapshot> = {}): RuntimeContextSnapshot {
  return {
    runtime_contract: {
      version: "v3_phase3",
      max_recent_messages: 8,
    },
    active_question: {
      question_id: "q1",
      question: {
        question_id: "q1",
        original_question: "原问题",
        entry_question: "当前问题",
        sub_questions: ["子问题1", "子问题2"],
        example_answer_styles: ["一句话版"],
        recommended_strategy: "direct",
        source_mode: "use_ai_refined",
      },
      node: {
        question_id: "q1",
        goal: "goal",
        user_facing_entry: "当前问题",
        target_dimensions: [{ id: "d1", label: "频率" }],
        completion_criteria: ["d1"],
        hypothesis_templates: [],
        node_summary_template: "summary",
      },
    },
    node_coverage: {
      covered_count: 0,
      required_count: 1,
      remaining_count: 1,
    },
    latest_user_turn: {
      message: "",
      turn_count: 1,
    },
    recent_memory: {
      user_turns: [],
      message_snippets: [],
    },
    structured_knowledge: {},
    recent_confirmed_referents: [],
    cross_question_anchor: null,
    unresolved_gaps: [{
      dimension_id: "d1",
      label: "频率",
      reason: "semantic_unmapped",
      severity: "high",
      actionable: true,
    }],
    pending_commitments: [],
    ui_state_hint: {
      pending_intent: null,
      latest_visible_summary: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  generateModelObjectMock.mockReset();
  generateModelObjectMock.mockResolvedValue({
    intent: "answer_question",
    confidence: 0.8,
    rationale: "model_default_answer",
  });
});

describe("askmore v2 intent router phase2", () => {
  test("explicit help phrase overrides model answer intent", async () => {
    const result = await routeIntent({
      userMessage: "尿尿的姿势有哪些呀？能给我一些例子描述吗",
      context: makeContext(),
    });

    expect(result.intent).toBe("ask_for_help");
    expect(result.rationale).toContain("help");
  });

  test("observation-standard question routes to clarify_meaning", async () => {
    const result = await routeIntent({
      userMessage: "怎么判断紧张感呢？什么行为算呢？",
      context: makeContext(),
    });

    expect(result.intent).toBe("clarify_meaning");
    expect(result.rationale).toContain("clarify");
  });

  test("pending ask_for_help keeps help on question-like continuation", async () => {
    const result = await routeIntent({
      userMessage: "那这个要怎么描述呢？",
      context: makeContext({
        ui_state_hint: {
          pending_intent: "ask_for_help",
          latest_visible_summary: null,
        },
      }),
    });

    expect(result.intent).toBe("ask_for_help");
  });

  test("choice payload forces answer_question", async () => {
    generateModelObjectMock.mockResolvedValue({
      intent: "ask_for_help",
      confidence: 0.92,
      rationale: "model_help",
    });

    const result = await routeIntent({
      userMessage: "已选择：局部小块",
      context: makeContext(),
      choice: {
        dimension_id: "d1",
        option_id: "A",
        option_label: "局部小块",
      },
    });

    expect(result.intent).toBe("answer_question");
  });

  test("summary shortcuts route to answer path", async () => {
    const result = await routeIntent({
      userMessage: "先看总结",
      context: makeContext(),
    });

    expect(result.intent).toBe("answer_question");
    expect(result.rationale).toContain("summary");
  });

  test("completion-check phrase routes to answer path", async () => {
    generateModelObjectMock.mockResolvedValue({
      intent: "other_discussion",
      confidence: 0.79,
      rationale: "model_discussion",
    });

    const result = await routeIntent({
      userMessage: "我已经答完了呀，为什么还在问？",
      context: makeContext(),
    });

    expect(result.intent).toBe("answer_question");
    expect(result.rationale).toContain("completion_check");
  });

  test("explicit clarify phrase routes to clarify_meaning", async () => {
    const result = await routeIntent({
      userMessage: "你是说让我确认排尿姿势吗？",
      context: makeContext(),
    });

    expect(result.intent).toBe("clarify_meaning");
  });
});
