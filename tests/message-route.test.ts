import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { createInitialState } from "@/lib/state";

const mockAddMessage = vi.fn(async () => {});
const mockPersist = vi.fn(async () => {});
const mockRunAgentTurn = vi.fn();

vi.mock("@/server/services/session", () => ({
  newMessageId: vi.fn(() => "turn-user-1"),
  getOrCreateSession: vi.fn(async () => ({
    stateRecord: {
      session_id: "session-1",
      state_jsonb: createInitialState("session-1"),
      preview_jsonb: {},
      assessment_jsonb: {},
      last_checkpoint_at: null,
    },
  })),
}));

vi.mock("@/server/repo", () => ({
  getInterviewRepository: vi.fn(() => ({
    addMessage: mockAddMessage,
  })),
}));

vi.mock("@/server/turn-controller", () => ({
  getTurnController: vi.fn(() => ({
    handleUserTurn: mockRunAgentTurn,
  })),
}));

vi.mock("@/server/services/persistence", () => ({
  persistStateAndSession: mockPersist,
}));

vi.mock("@/server/rules/completion", () => ({
  evaluateCompletion: vi.fn(() => ({
    completion_level: "incomplete",
    completion_score: 0,
  })),
}));

vi.mock("@/server/model/adapters", () => ({
  getContextWindowInfo: vi.fn(() => ({
    modelUsed: "gpt-5",
    provider: "openai",
    maxContextTokens: 400000,
    usedTokens: 1200,
    utilizationPercent: 0.3,
    breakdown: {
      systemPromptTokens: 300,
      userPromptTokens: 700,
      completionTokens: 200,
    },
    estimatedCostUsd: 0.01,
  })),
  getCumulativeTokenUsage: vi.fn(() => ({
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 1200,
  })),
}));

describe("/api/interview/message route", () => {
  beforeEach(() => {
    mockAddMessage.mockReset();
    mockPersist.mockReset();
    mockRunAgentTurn.mockReset();
  });

  test("returns telemetry and authoritative section fields", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockRunAgentTurn.mockResolvedValueOnce({
      assistant_message: "Thanks — could you share one concrete example?",
      interaction_module: { type: "none", payload: {} },
      updated_preview: { sections: {} },
      workflow_state: {
        phase: "interviewing",
        active_section_id: "company_understanding",
        pending_review_section_id: null,
        pending_interaction_module: null,
        next_question_slot_id: "company_understanding.problem_solved",
        required_open_slot_ids: ["company_understanding.problem_solved"],
        transition_allowed: false,
        last_transition_reason: "still_waiting",
      },
      planner_task_type: "answer_question",
      model_route_used: { model: "gpt-5", provider: "openai" },
      tool_trace: [],
      planner_trace: {},
    });

    const { POST } = await import("../app/api/interview/message/route");
    const request = new NextRequest("http://localhost/api/interview/message", {
      method: "POST",
      body: JSON.stringify({
        session_id: "session-1",
        user_message: "We provide API search for enterprise docs.",
        language: "en",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.context_window).toBeTruthy();
    expect(data.cumulative_tokens).toBeTruthy();
    expect(typeof data.current_section_index).toBe("number");
    expect(typeof data.current_section_name).toBe("string");
    expect(
      logSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("runtime=route.interview.message") &&
          String(call[0]).includes("phase=run") &&
          String(call[0]).includes("event=start"),
      ),
    ).toBe(true);
    expect(
      logSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("runtime=route.interview.message") &&
          String(call[0]).includes("phase=run") &&
          String(call[0]).includes("result=ok"),
      ),
    ).toBe(true);
  });

  test("logs request failure envelope when runtime throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRunAgentTurn.mockRejectedValueOnce(new Error("forced turn error"));

    const { POST } = await import("../app/api/interview/message/route");
    const request = new NextRequest("http://localhost/api/interview/message", {
      method: "POST",
      body: JSON.stringify({
        session_id: "session-1",
        user_message: "hello",
        language: "en",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("forced turn error");
    expect(
      errorSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("runtime=route.interview.message") &&
          String(call[0]).includes("result=fail"),
      ),
    ).toBe(true);
  });
});
