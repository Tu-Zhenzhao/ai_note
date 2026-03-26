import { describe, expect, test } from "vitest";
import {
  createPendingCommitment,
  expirePendingCommitments,
  getOpenCommitments,
  resolvePendingCommitments,
} from "@/server/askmore_v2/runtime/pending-commitments";
import { ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";

function makeState() {
  return ensureRuntimeStateDefaults({
    session: {
      current_question_id: "q1",
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
    nodes: {},
    node_runtime: {},
    question_progress: {},
    structured_knowledge: {},
    latest_summary_text: null,
    latest_structured_report: null,
    runtime_meta: {},
  } as any);
}

describe("askmore v2 pending commitments lifecycle", () => {
  test("create -> resolve", () => {
    const state = makeState();
    const now = new Date().toISOString();

    const created = createPendingCommitment({
      state,
      type: "micro_confirm",
      questionId: "q1",
      dimensionId: "d1",
      now,
      turnIndex: 1,
      note: "await confirm",
    });

    expect(created.status).toBe("pending");
    expect(getOpenCommitments({ state, questionId: "q1" }).length).toBe(1);

    const resolved = resolvePendingCommitments({
      state,
      now: new Date(Date.now() + 1_000).toISOString(),
      turnIndex: 2,
      questionId: "q1",
      dimensionId: "d1",
      reason: "user_confirmed",
    });

    expect(resolved).toBe(1);
    expect(getOpenCommitments({ state, questionId: "q1" }).length).toBe(0);
  });

  test("question switch expires stale commitment", () => {
    const state = makeState();
    createPendingCommitment({
      state,
      type: "follow_up",
      questionId: "q1",
      dimensionId: "d2",
      now: new Date().toISOString(),
      turnIndex: 1,
      note: "await follow up",
    });

    const expired = expirePendingCommitments({
      state,
      now: new Date(Date.now() + 1_000).toISOString(),
      turnIndex: 2,
      activeQuestionId: "q2",
    });

    expect(expired.length).toBe(1);
    expect(expired[0]?.status).toBe("expired");
    expect(getOpenCommitments({ state }).length).toBe(0);
  });
});
