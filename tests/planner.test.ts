import { describe, expect, test } from "vitest";
import { createInitialState } from "@/lib/state";
import { getInterviewRepository } from "@/server/repo";
import { runPlannerTurn } from "@/server/planner/runtime";
import { CompletionState } from "@/lib/types";

function mockCompletion(overrides: Partial<CompletionState> = {}): CompletionState {
  return {
    completion_level: "incomplete",
    completion_score: 30,
    generation_permission_flag: false,
    missing_fields: [],
    weak_fields: [],
    unconfirmed_fields: [],
    red_line_blockers: [],
    open_checklist_items: [],
    checkpoint_recommended: false,
    next_best_move: "ask",
    verification_coverage: 0,
    evidence_confidence_score: 0,
    planner_confidence: 0.3,
    model_route_used: null,
    ...overrides,
  };
}

describe("v3 planner runtime", () => {
  test("stores planner/tool trace and chat-book entries", async () => {
    const sessionId = "planner-1";
    const state = createInitialState(sessionId);

    const decision = await runPlannerTurn({
      sessionId,
      turnId: "turn-1",
      userMessage: "We provide managed search APIs for operations teams.",
      state,
      completionState: mockCompletion(),
    });

    const trace = await getInterviewRepository().getSessionTrace(sessionId, 200);
    expect(decision.plannerAction).toBeDefined();
    expect(trace.planner_decisions.length).toBeGreaterThan(0);
    expect(trace.tool_action_log.length).toBeGreaterThan(0);
  });

  test("anti-repeat guard switches to summarize/confirm", async () => {
    const sessionId = "planner-2";
    const state = createInitialState(sessionId);
    const repo = getInterviewRepository();

    await repo.addMessage({
      id: "assist-1",
      session_id: sessionId,
      role: "assistant",
      content: "Could you briefly describe what your company does?",
      created_at: new Date().toISOString(),
    });

    const decision = await runPlannerTurn({
      sessionId,
      turnId: "turn-2",
      userMessage: "Still thinking.",
      state,
      completionState: mockCompletion({ completion_score: 35 }),
    });

    expect(decision.plannerAction).toBe("summarize");
    expect(decision.questionStyle).toBe("synthesize_and_confirm");
  });

  test("conflict is reconciled once then downgraded", async () => {
    const sessionId = "planner-3";
    const state = createInitialState(sessionId);
    state.system_assessment.pending_conflicts.push({
      field: "company_profile.business_model",
      conflicting_values: ["software", "service"],
      status: "pending",
      asks: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const first = await runPlannerTurn({
      sessionId,
      turnId: "turn-1",
      userMessage: "Actually both.",
      state,
      completionState: mockCompletion({
        completion_level: "minimally_ready",
        completion_score: 58,
      }),
    });
    const second = await runPlannerTurn({
      sessionId,
      turnId: "turn-2",
      userMessage: "Not sure.",
      state,
      completionState: mockCompletion({
        completion_level: "minimally_ready",
        completion_score: 58,
      }),
    });

    expect(first.questionStyle).toBe("resolve_conflict_once");
    expect(second.questionStyle).not.toBe("resolve_conflict_once");
    expect(state.system_assessment.pending_conflicts[0].status).toBe("downgraded");
  });
});
