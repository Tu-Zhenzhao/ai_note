import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { routeClarifySubtype } from "@/server/askmore_v2/services/clarify-subtype-router";
import { RuntimeContextSnapshot } from "@/server/askmore_v2/runtime/context-engine";

function makeContext(): RuntimeContextSnapshot {
  return {
    runtime_contract: {
      version: "v3_phase3",
      max_recent_messages: 8,
    },
    active_question: {
      question_id: "q2",
      question: {
        question_id: "q2",
        original_question: "你从什么时候开始感受到这种状态？",
        entry_question: "你从什么时候开始感受到这种状态？",
        sub_questions: ["开始时间", "持续多久"],
        example_answer_styles: ["最近两周开始"],
        recommended_strategy: "timeline",
        source_mode: "use_ai_refined",
      },
      node: {
        question_id: "q2",
        goal: "timeline",
        user_facing_entry: "你从什么时候开始感受到这种状态？",
        target_dimensions: [{ id: "timeline", label: "开始时间" }],
        completion_criteria: ["timeline"],
        hypothesis_templates: [],
        node_summary_template: "",
      },
    },
    node_coverage: {
      covered_count: 0,
      required_count: 1,
      remaining_count: 1,
    },
    latest_user_turn: {
      message: "",
      turn_count: 2,
    },
    recent_memory: {
      user_turns: ["我最近一直很焦虑"],
      message_snippets: [],
    },
    structured_knowledge: {},
    recent_confirmed_referents: [
      {
        question_id: "q1",
        dimension_id: "emotion_state",
        label: "情绪状态",
        value: "焦虑",
        source: "previous_question",
      },
    ],
    cross_question_anchor: {
      question_id: "q1",
      dimension_id: "emotion_state",
      label: "情绪状态",
      value: "焦虑",
      source: "previous_question",
    },
    unresolved_gaps: [
      {
        dimension_id: "timeline",
        label: "开始时间",
        reason: "semantic_unmapped",
        severity: "high",
        actionable: true,
      },
    ],
    pending_commitments: [],
    ui_state_hint: {
      pending_intent: "clarify_meaning",
      latest_visible_summary: null,
    },
  };
}

beforeEach(() => {
  generateModelObjectMock.mockReset();
  generateModelObjectMock.mockResolvedValue({
    subtype: "value_clarify",
    confidence: 0.78,
    rationale: "model_default_value",
  });
});

describe("askmore v2 clarify subtype router", () => {
  test("referent signal overrides model", async () => {
    const result = await routeClarifySubtype({
      userMessage: "你问的是哪种状态，是我前面那个焦虑吗？",
      context: makeContext(),
    });
    expect(result.subtype).toBe("referent_clarify");
    expect(result.rationale).toContain("referent");
  });

  test("concept signal overrides model", async () => {
    const result = await routeClarifySubtype({
      userMessage: "这里什么叫持续一段时间？怎么判断？",
      context: makeContext(),
    });
    expect(result.subtype).toBe("concept_clarify");
    expect(result.rationale).toContain("concept");
  });

  test("value signal routes to value_clarify", async () => {
    const result = await routeClarifySubtype({
      userMessage: "你是问每周还是每天？",
      context: makeContext(),
    });
    expect(result.subtype).toBe("value_clarify");
  });
});
