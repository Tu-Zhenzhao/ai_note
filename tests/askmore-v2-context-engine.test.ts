import { describe, expect, test } from "vitest";
import { buildRuntimeContextSnapshot, ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";
import { AskmoreV2Session } from "@/server/askmore_v2/types";

function makeSession(): AskmoreV2Session {
  const state = ensureRuntimeStateDefaults({
    session: {
      current_question_id: "q1",
      current_sub_question_index: 0,
      summary_generated: false,
      finalized: false,
      pending_end_confirmation: false,
      last_missing_points: [],
      last_understanding_feedback: null,
      pending_intent: null,
      pending_commitments: [
        {
          id: "c1",
          type: "micro_confirm",
          status: "pending",
          question_id: "q1",
          dimension_id: "d1",
          created_at: new Date().toISOString(),
        },
      ],
    },
    recent_user_turns: ["最近一周开始", "在猫砂盆外尿"],
    recent_dimension_prompts: [],
    nodes: {
      q1: {
        question_id: "q1",
        goal: "goal",
        user_facing_entry: "现在先说说最近一周乱尿情况",
        target_dimensions: [
          { id: "d1", label: "开始时间" },
          { id: "d2", label: "位置分布" },
        ],
        completion_criteria: ["d1"],
        hypothesis_templates: [],
        node_summary_template: "",
      },
    },
    node_runtime: {
      q1: {
        question_id: "q1",
        captured_dimensions: {},
        dimension_confidence: { d1: 0.2, d2: 0.1 },
        dimension_soft_confidence: {},
        dimension_state: {},
        dimension_unresolved_reason: { d1: "ambiguous_temporal", d2: "semantic_unmapped" },
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
    id: "s1",
    flow_version_id: "f1",
    status: "in_progress",
    turn_count: 2,
    state_version: 1,
    state_jsonb: state,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("askmore v2 context engine phase3", () => {
  test("builds compact question-related memory and enriched gaps", () => {
    const session = makeSession();
    const snapshot = buildRuntimeContextSnapshot({
      session,
      questions: [
        {
          question_id: "q1",
          original_question: "原问题",
          entry_question: "请说说最近一周乱尿情况",
          sub_questions: ["开始时间", "位置分布"],
          example_answer_styles: [],
          recommended_strategy: "direct",
          source_mode: "use_ai_refined",
        },
      ],
      userMessage: "最近一周开始在猫砂盆外尿",
      recentMessages: [
        {
          id: "m1",
          session_id: "s1",
          role: "assistant",
          message_text: "现在问你开始时间",
          created_at: new Date().toISOString(),
        },
        {
          id: "m2",
          session_id: "s1",
          role: "user",
          message_text: "最近一周开始",
          created_at: new Date().toISOString(),
        },
        {
          id: "m3",
          session_id: "s1",
          role: "assistant",
          message_text: "另一个无关问题",
          created_at: new Date().toISOString(),
        },
      ],
    });

    expect(snapshot.runtime_contract.version).toBe("v3_phase3");
    expect(snapshot.recent_memory.user_turns.length).toBeGreaterThan(0);
    expect(Array.isArray(snapshot.recent_memory.message_snippets)).toBe(true);
    expect(snapshot.recent_memory.message_snippets.length).toBeLessThanOrEqual(8);
    expect(snapshot.unresolved_gaps.some((gap) => gap.severity === "high")).toBe(true);
    expect(snapshot.unresolved_gaps.some((gap) => gap.actionable)).toBe(true);
    expect(Array.isArray(snapshot.pending_commitments)).toBe(true);
  });
});
