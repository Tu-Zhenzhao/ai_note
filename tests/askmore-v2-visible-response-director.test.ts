import { describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { buildVisibleEvents } from "@/server/askmore_v2/presentation/visible-response-director";
import { AskmoreV2InternalEvent, AskmoreV2SessionState } from "@/server/askmore_v2/types";

function makeState(): AskmoreV2SessionState {
  return {
    session: {
      current_question_id: null,
      current_sub_question_index: 0,
      summary_generated: true,
      finalized: false,
      pending_end_confirmation: false,
      last_missing_points: [],
      last_understanding_feedback: null,
      pending_intent: "answer_question",
      pending_commitments: [],
      active_turn_index: 6,
    },
    recent_user_turns: [],
    recent_dimension_prompts: [],
    nodes: {},
    node_runtime: {},
    question_progress: {},
    structured_knowledge: {
      q1__pet_type: {
        value: "猫咪",
        confidence: 0.9,
        confirmed: true,
        updated_at: new Date().toISOString(),
      },
    },
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
      payload: { content: "我了解到猫咪近期出现了血尿和应激表现。" },
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
      payload: { content: "还缺的关键点：排尿时间段" },
    },
    {
      event_id: "e4",
      event_type: "transition_summary",
      created_at: now,
      visible: true,
      payload: { content: "好的，我们继续。我先把这个关键点问清楚，这样后面的判断会更稳。" },
    },
    {
      event_id: "e5",
      event_type: "next_question",
      created_at: now,
      visible: true,
      payload: { content: "排尿主要发生在什么时候？" },
    },
  ];
}

describe("askmore v2 visible response director", () => {
  test("completion transition reason enforces closure output and blocks continue-style branches", async () => {
    generateModelObjectMock.mockReset();
    generateModelObjectMock.mockRejectedValue(new Error("model unavailable"));

    const events = await buildVisibleEvents({
      debugEvents: makeDebugEvents(),
      routedIntent: {
        intent: "answer_question",
        confidence: 0.92,
      },
      state: makeState(),
      language: "zh",
      scenario: "宠物问诊",
      targetOutputType: "咨询总结",
      transitionReason: "all_questions_completed",
      latestUserTurn: "最近几天血尿比较明显",
    });

    expect(events.some((item) => item.event_type === "next_step")).toBe(false);
    expect(events.some((item) => item.event_type === "gentle_gap_prompt")).toBe(false);
    const transition = events.find((item) => item.event_type === "transition");
    const transitionText = String(transition?.payload.content ?? "");
    expect(transitionText).toContain("本次健康咨询已完成。");
    expect(transitionText).toContain("AI思考");
    expect(transitionText).not.toContain("好的，我们继续");
  });
});
