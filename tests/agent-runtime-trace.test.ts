import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createInitialState } from "@/lib/state";

const {
  classifyTurnMock,
  runAnswerQuestionTaskMock,
  runHelpAboutQuestionTaskMock,
  runDiscussionTaskMock,
  evaluateCompletionMock,
  composePreviewMock,
  syncWorkflowStateMock,
  getLastModelRouteMock,
} = vi.hoisted(() => ({
  classifyTurnMock: vi.fn(),
  runAnswerQuestionTaskMock: vi.fn(),
  runHelpAboutQuestionTaskMock: vi.fn(),
  runDiscussionTaskMock: vi.fn(),
  evaluateCompletionMock: vi.fn(),
  composePreviewMock: vi.fn(),
  syncWorkflowStateMock: vi.fn(),
  getLastModelRouteMock: vi.fn(),
}));

vi.mock("@/server/repo", () => ({
  getInterviewRepository: vi.fn(() => ({})),
}));

vi.mock("@/server/agent/planner", () => ({
  classifyTurn: classifyTurnMock,
}));

vi.mock("@/server/agent/tasks/answer-question", () => ({
  runAnswerQuestionTask: runAnswerQuestionTaskMock,
}));

vi.mock("@/server/agent/tasks/help-about-question", () => ({
  runHelpAboutQuestionTask: runHelpAboutQuestionTaskMock,
}));

vi.mock("@/server/agent/tasks/discussion", () => ({
  runDiscussionTask: runDiscussionTaskMock,
}));

vi.mock("@/server/rules/completion", () => ({
  evaluateCompletion: evaluateCompletionMock,
}));

vi.mock("@/server/services/preview", () => ({
  composePreview: composePreviewMock,
}));

vi.mock("@/server/services/workflow", () => ({
  syncWorkflowState: syncWorkflowStateMock,
}));

vi.mock("@/server/model/adapters", () => ({
  getLastModelRoute: getLastModelRouteMock,
}));

function makeToolLog(toolName: string) {
  return {
    id: `${toolName}-1`,
    session_id: "session-1",
    turn_id: "turn-1",
    tool_name: toolName,
    input_json: {},
    output_json: {},
    success: true,
    created_at: new Date().toISOString(),
  };
}

describe("runAgentTurn trace logging", () => {
  const prevVerbose = process.env.AGENT_TRACE_VERBOSE;

  beforeEach(() => {
    classifyTurnMock.mockReset();
    runAnswerQuestionTaskMock.mockReset();
    runHelpAboutQuestionTaskMock.mockReset();
    runDiscussionTaskMock.mockReset();
    evaluateCompletionMock.mockReset();
    composePreviewMock.mockReset();
    syncWorkflowStateMock.mockReset();
    getLastModelRouteMock.mockReset();
    process.env.AGENT_TRACE_VERBOSE = "true";
  });

  afterEach(() => {
    process.env.AGENT_TRACE_VERBOSE = prevVerbose;
    vi.restoreAllMocks();
  });

  test("logs ordered legacy runtime steps on success", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    classifyTurnMock.mockResolvedValueOnce({
      classification: { task_type: "answer_question", rationale: "Direct answer" },
      plannerTrace: { strategy: "test" },
      toolLogs: [makeToolLog("planner")],
    });
    runAnswerQuestionTaskMock.mockResolvedValueOnce({
      assistantMessage: "Captured. Next question?",
      interactionModule: { type: "none", payload: {} },
      toolLogs: [makeToolLog("answer_turn_controller")],
      nextQuestion: "Next question?",
      questionType: "clarify",
      extractionContractSummary: null,
    });
    evaluateCompletionMock.mockReturnValueOnce({
      completion_level: "incomplete",
      completion_score: 0.4,
    });
    composePreviewMock.mockReturnValueOnce({ sections: {} });
    getLastModelRouteMock.mockReturnValue({ modelUsed: "gpt-5", provider: "openai" });

    const { runAgentTurn } = await import("@/server/agent/agent-runtime");

    const result = await runAgentTurn({
      sessionId: "session-1",
      userMessage: "We build enterprise search.",
      userTurnId: "turn-1",
      state: createInitialState("session-1"),
      language: "en",
    });

    expect(result.planner_task_type).toBe("answer_question");

    const lines = logSpy.mock.calls.map((call) => String(call[0]));
    const requiredSteps = [
      "step=migrate_state",
      "step=reset_turn_state",
      "step=classify_turn",
      "step=route_task",
      "step=run_answer_task",
      "step=evaluate_completion",
      "step=compose_preview",
      "step=sync_workflow",
      "step=assemble_result",
    ];

    for (const marker of requiredSteps) {
      expect(lines.some((line) => line.includes(marker))).toBe(true);
    }
  });

  test("logs step failure and rethrows on required legacy step error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    classifyTurnMock.mockRejectedValueOnce(new Error("classifier unavailable"));

    const { runAgentTurn } = await import("@/server/agent/agent-runtime");

    await expect(
      runAgentTurn({
        sessionId: "session-1",
        userMessage: "hello",
        userTurnId: "turn-2",
        state: createInitialState("session-1"),
        language: "en",
      }),
    ).rejects.toThrow("classifier unavailable");

    expect(
      errorSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("step=classify_turn") &&
          String(call[0]).includes("result=fail"),
      ),
    ).toBe(true);
  });
});
