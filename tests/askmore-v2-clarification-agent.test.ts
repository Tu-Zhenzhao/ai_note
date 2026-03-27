import { beforeEach, describe, expect, test, vi } from "vitest";
import { runClarificationAgent } from "@/server/askmore_v2/agents/clarification-agent";
import { AgentRunInput } from "@/server/askmore_v2/agents/contracts";
import { ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";

const { routeClarifySubtypeMock, generateHelpCoachingMock, generateMicroConfirmationMock } = vi.hoisted(() => ({
  routeClarifySubtypeMock: vi.fn(),
  generateHelpCoachingMock: vi.fn(),
  generateMicroConfirmationMock: vi.fn(),
}));

vi.mock("@/server/askmore_v2/services/clarify-subtype-router", () => ({
  routeClarifySubtype: routeClarifySubtypeMock,
}));

vi.mock("@/server/askmore_v2/services/help-coaching", () => ({
  generateHelpCoaching: generateHelpCoachingMock,
}));

vi.mock("@/server/askmore_v2/services/micro-confirm-generator", () => ({
  generateMicroConfirmation: generateMicroConfirmationMock,
}));

function makeInput(): AgentRunInput {
  const state = ensureRuntimeStateDefaults({
    session: {
      current_question_id: "q2",
      current_sub_question_index: 0,
      summary_generated: false,
      finalized: false,
      pending_end_confirmation: false,
      last_missing_points: [],
      last_understanding_feedback: null,
      pending_intent: null,
      pending_commitments: [],
    },
    recent_user_turns: [],
    recent_dimension_prompts: [],
    nodes: {
      q2: {
        question_id: "q2",
        goal: "timeline",
        user_facing_entry: "这种状态大概从什么时候开始的？",
        target_dimensions: [{ id: "timeline", label: "开始时间" }],
        completion_criteria: ["timeline"],
        hypothesis_templates: [],
        node_summary_template: "",
      },
    },
    node_runtime: {
      q2: {
        question_id: "q2",
        captured_dimensions: {},
        dimension_confidence: { timeline: 0.2 },
        dimension_soft_confidence: {},
        dimension_state: {},
        dimension_unresolved_reason: { timeline: "ambiguous_temporal" },
        dimension_answered: {},
        dimension_answered_evidence: {},
        dimension_micro_confirmed: {},
        dimension_priority_current: {},
        dimension_priority_candidate: {},
        dimension_priority_streak: {},
        dimension_priority_reason: {},
        dimension_priority_downgraded_by_limit: {},
        clarify_count: 0,
        node_status: "partial",
        candidate_hypothesis: null,
        last_node_summary: null,
        contradiction_detected: false,
        last_micro_confirm_offer: null,
      },
    },
    question_progress: {},
    structured_knowledge: {},
    latest_summary_text: null,
    latest_structured_report: null,
    runtime_meta: {},
  } as any);

  return {
    session: {
      id: "s1",
      flow_version_id: "f1",
      status: "in_progress",
      turn_count: 1,
      state_version: 1,
      state_jsonb: state,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    flow: {
      scenario: "心理咨询 intake",
      target_output_type: "结构化总结",
      questions: [
        {
          question_id: "q1",
          original_question: "情绪状态",
          entry_question: "最近这段时间，你最明显感受到的情绪或状态是什么？",
          sub_questions: ["状态"],
          example_answer_styles: [],
          recommended_strategy: "direct",
          source_mode: "use_ai_refined",
        },
        {
          question_id: "q2",
          original_question: "开始时间",
          entry_question: "这种状态大概从什么时候开始的？",
          sub_questions: ["开始时间"],
          example_answer_styles: [],
          recommended_strategy: "timeline",
          source_mode: "use_ai_refined",
        },
      ],
    },
    sessionId: "s1",
    userMessage: "你问的是哪种状态，是前面那个吗？",
    language: "zh",
    intent: "clarify_meaning",
    context: {
      runtime_contract: { version: "v3_phase3", max_recent_messages: 8 },
      active_question: {
        question_id: "q2",
        question: {
          question_id: "q2",
          original_question: "开始时间",
          entry_question: "这种状态大概从什么时候开始的？",
          sub_questions: ["开始时间"],
          example_answer_styles: [],
          recommended_strategy: "timeline",
          source_mode: "use_ai_refined",
        },
        node: {
          question_id: "q2",
          goal: "timeline",
          user_facing_entry: "这种状态大概从什么时候开始的？",
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
      latest_user_turn: { message: "你问的是哪种状态，是前面那个吗？", turn_count: 1 },
      recent_memory: {
        user_turns: ["我最近总特别焦虑"],
        message_snippets: [],
      },
      structured_knowledge: {
        q1__emotion_state: "焦虑",
      },
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
      unresolved_gaps: [{
        dimension_id: "timeline",
        label: "开始时间",
        reason: "semantic_unmapped",
        severity: "high",
        actionable: true,
      }],
      pending_commitments: [],
      ui_state_hint: {
        pending_intent: "clarify_meaning",
        latest_visible_summary: null,
      },
    },
  };
}

beforeEach(() => {
  routeClarifySubtypeMock.mockReset();
  generateHelpCoachingMock.mockReset();
  generateMicroConfirmationMock.mockReset();
});

describe("askmore v2 clarification agent subtype routing", () => {
  test("referent_clarify resolves referent and returns to mainline without micro_confirm", async () => {
    routeClarifySubtypeMock.mockResolvedValue({
      subtype: "referent_clarify",
      confidence: 0.96,
      rationale: "referent_rule_override",
    });

    const result = await runClarificationAgent(makeInput());

    expect(result.events.some((event) => event.event_type === "micro_confirm")).toBe(false);
    expect(result.events.some((event) => event.event_type === "next_question")).toBe(true);
    expect(result.state.runtime_meta?.last_clarify_subtype).toBe("referent_clarify");
    expect(result.state.runtime_meta?.last_resolved_referent).toContain("焦虑");
    expect(result.transition_reason).toBe("clarification_referent_resolved_then_return_mainline");
  });

  test("concept_clarify explains concept then reconnects mainline", async () => {
    routeClarifySubtypeMock.mockResolvedValue({
      subtype: "concept_clarify",
      confidence: 0.92,
      rationale: "concept_rule_override",
    });
    generateHelpCoachingMock.mockResolvedValue({
      obstacle_layer: "concept",
      resolution_goal: "describe_timeline",
      direct_help_answer: "这里的状态是指你前面提到的焦虑感受。",
      downgraded_question: "你先说一个最确定的时间点，比如大概从哪周开始明显。",
      explanatory_examples: ["先说最近两周还是一个月左右。"],
      answer_examples: ["我大概是三周前开始明显焦虑。"],
      reconnect_prompt: "好，我们就按这个时间点继续。",
    });

    const result = await runClarificationAgent(makeInput());

    expect(result.events.some((event) => event.event_type === "help_explanation")).toBe(true);
    expect(result.events.some((event) => event.event_type === "micro_confirm")).toBe(false);
    expect(result.next_question?.question_text).toContain("最确定");
    expect(result.state.runtime_meta?.last_clarify_subtype).toBe("concept_clarify");
  });

  test("value_clarify keeps micro_confirm path only", async () => {
    routeClarifySubtypeMock.mockResolvedValue({
      subtype: "value_clarify",
      confidence: 0.9,
      rationale: "value_rule_override",
    });
    generateMicroConfirmationMock.mockResolvedValue({
      ack_text: "我先做一个小确认来对齐取值。",
      options: [
        { option_id: "A", label: "最近几天", normalized_value: "recent_days" },
        { option_id: "B", label: "最近几周", normalized_value: "recent_weeks" },
        { option_id: "C", label: "最近一个月", normalized_value: "recent_month" },
      ],
      allow_free_text: true,
    });

    const result = await runClarificationAgent(makeInput());

    expect(result.events.some((event) => event.event_type === "micro_confirm")).toBe(true);
    expect(result.events.some((event) => event.event_type === "next_question")).toBe(false);
    expect(result.state.session.pending_commitments?.some((item) => item.type === "micro_confirm")).toBe(true);
    expect(result.state.runtime_meta?.last_clarify_subtype).toBe("value_clarify");
  });
});
