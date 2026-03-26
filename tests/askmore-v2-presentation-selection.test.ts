import { describe, expect, test } from "vitest";
import { selectPresentationDraftEvents } from "@/server/askmore_v2/presentation/event-selection";
import { AskmoreV2InternalEvent, AskmoreV2SessionState } from "@/server/askmore_v2/types";

function makeState(finalized: boolean): AskmoreV2SessionState {
  return {
    session: {
      current_question_id: "q1",
      current_sub_question_index: 0,
      summary_generated: false,
      finalized,
      pending_end_confirmation: false,
      last_missing_points: [],
      last_understanding_feedback: null,
      pending_intent: "answer_question",
      pending_commitments: [],
      active_turn_index: 1,
    },
    recent_user_turns: [],
    recent_dimension_prompts: [],
    nodes: {},
    node_runtime: {},
    question_progress: {},
    structured_knowledge: {},
    latest_summary_text: null,
    latest_structured_report: null,
    runtime_meta: {},
  };
}

function makeDebugEvents(): AskmoreV2InternalEvent[] {
  const now = new Date().toISOString();
  return [
    {
      event_id: "e1",
      event_type: "understanding_summary",
      created_at: now,
      visible: true,
      payload: { content: "我先接住你刚刚这段信息。" },
    },
    {
      event_id: "e2",
      event_type: "coverage_summary",
      created_at: now,
      visible: true,
      payload: { content: "当前关键覆盖：3/3。" },
    },
    {
      event_id: "e3",
      event_type: "gap_notice",
      created_at: now,
      visible: true,
      payload: { content: "还缺的关键点：可选补充点" },
    },
    {
      event_id: "e4",
      event_type: "transition_summary",
      created_at: now,
      visible: true,
      payload: { content: "关键信息已收齐，本次访谈完成。" },
    },
    {
      event_id: "e5",
      event_type: "next_question",
      created_at: now,
      visible: true,
      payload: {
        content: "我还想再确认一下可选补充点。",
        mode: "follow_up_select",
        badge_label: "普通追问",
        dimension_id: "d_follow_up",
        options: [
          { option_id: "A", label: "选项A", normalized_value: "a" },
          { option_id: "B", label: "选项B", normalized_value: "b" },
        ],
      },
    },
  ];
}

describe("askmore v2 presentation selection", () => {
  test("finalized turn suppresses gap prompt and next step", () => {
    const drafts = selectPresentationDraftEvents({
      debugEvents: makeDebugEvents(),
      routedIntent: {
        intent: "answer_question",
        confidence: 0.9,
      },
      state: makeState(true),
      language: "zh",
    });

    expect(drafts.some((item) => item.event_type === "gentle_gap_prompt")).toBe(false);
    expect(drafts.some((item) => item.event_type === "next_step")).toBe(false);
    expect(drafts.some((item) => item.event_type === "transition")).toBe(true);
  });

  test("non-finalized turn can include gap prompt and next step", () => {
    const debugEvents = makeDebugEvents().map((event) =>
      event.event_type === "transition_summary"
        ? { ...event, payload: { content: "我们先留在当前题，把关键缺口补齐。" } }
        : event,
    );
    const drafts = selectPresentationDraftEvents({
      debugEvents,
      routedIntent: {
        intent: "answer_question",
        confidence: 0.9,
      },
      state: makeState(false),
      language: "zh",
    });

    expect(drafts.some((item) => item.event_type === "gentle_gap_prompt")).toBe(true);
    expect(drafts.some((item) => item.event_type === "next_step")).toBe(true);
    const nextStep = drafts.find((item) => item.event_type === "next_step");
    expect(nextStep?.mode).toBe("follow_up_select");
    expect(nextStep?.badge_label).toBe("普通追问");
    expect((nextStep?.options ?? []).length).toBeGreaterThan(0);
  });
});
