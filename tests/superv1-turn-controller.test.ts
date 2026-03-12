import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startSuperV1Conversation } from "@/server/superv1/services/conversation-service";
import { getSuperV1TurnController } from "@/server/superv1/turn-controller";
import { getSuperV1Repository } from "@/server/superv1/repo";

const { generateModelObjectMock, generateModelTextMock, addChatBookEntryMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
  generateModelTextMock: vi.fn(),
  addChatBookEntryMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
  generateModelText: generateModelTextMock,
}));

vi.mock("@/server/repo", () => ({
  getInterviewRepository: vi.fn(() => ({
    addChatBookEntry: addChatBookEntryMock,
  })),
}));

describe("superv1 turn controller", () => {
  const prevVerbose = process.env.AGENT_TRACE_VERBOSE;

  beforeEach(() => {
    generateModelObjectMock.mockReset();
    generateModelTextMock.mockReset();
    addChatBookEntryMock.mockReset();
    addChatBookEntryMock.mockResolvedValue(undefined);
    process.env.AGENT_TRACE_VERBOSE = "false";
  });

  afterEach(() => {
    process.env.AGENT_TRACE_VERBOSE = prevVerbose;
    vi.restoreAllMocks();
  });

  test("answer_question flow persists turns and extraction/planner events", async () => {
    const started = await startSuperV1Conversation();
    const controller = getSuperV1TurnController();

    generateModelObjectMock
      .mockResolvedValueOnce({
        intent: "answer_question",
        confidence: 0.95,
        reason: "Direct answer",
      })
      .mockResolvedValueOnce({
        filled_items: [
          {
            question_id: "cp_what_does_company_do",
            value: "We provide enterprise search APIs.",
            confidence: 0.92,
            evidence: "We provide enterprise search APIs.",
          },
        ],
        ambiguous_items: [],
        possible_items: [],
      });
    generateModelTextMock.mockResolvedValueOnce(
      "Captured. Next key question: Who is the primary audience?",
    );

    const result = await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "We provide enterprise search APIs.",
      language: "en",
    });

    const repo = getSuperV1Repository();
    const turns = await repo.listTurns(started.conversationId);
    const extractionEvents = await repo.listExtractionEvents(started.conversationId);
    const plannerEvents = await repo.listPlannerEvents(started.conversationId);

    expect(result.intent.intent).toBe("answer_question");
    expect(result.reply.length).toBeGreaterThan(10);
    expect(turns).toHaveLength(2);
    expect(extractionEvents.length).toBeGreaterThan(0);
    expect(plannerEvents.length).toBeGreaterThan(0);
  });

  test("ask_for_help flow keeps checklist answers unchanged", async () => {
    const started = await startSuperV1Conversation();
    const controller = getSuperV1TurnController();
    const repo = getSuperV1Repository();
    const before = await repo.listAnswers(started.conversationId);

    generateModelObjectMock.mockResolvedValueOnce({
      intent: "ask_for_help",
      confidence: 0.91,
      reason: "User asked for suggestions",
    });
    generateModelTextMock.mockResolvedValueOnce("Let's make this easy: start with who you serve.");

    const result = await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "I'm not sure, can you help me?",
      language: "en",
    });

    const after = await repo.listAnswers(started.conversationId);

    expect(result.intent.intent).toBe("ask_for_help");
    expect(after.map((entry) => entry.status)).toEqual(before.map((entry) => entry.status));
  });

  test("logs superv1 step movement and continues on legacy chatbook failure", async () => {
    process.env.AGENT_TRACE_VERBOSE = "true";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    addChatBookEntryMock.mockRejectedValueOnce(new Error("legacy repo unavailable"));

    const started = await startSuperV1Conversation();
    const controller = getSuperV1TurnController();

    generateModelObjectMock
      .mockResolvedValueOnce({
        intent: "answer_question",
        confidence: 0.95,
        reason: "Direct answer",
      })
      .mockResolvedValueOnce({
        filled_items: [
          {
            question_id: "cp_what_does_company_do",
            value: "We provide enterprise search APIs.",
            confidence: 0.92,
            evidence: "We provide enterprise search APIs.",
          },
        ],
        ambiguous_items: [],
        possible_items: [],
      });
    generateModelTextMock.mockResolvedValueOnce(
      "Captured. Next key question: Who is the primary audience?",
    );

    const result = await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "We provide enterprise search APIs.",
      language: "en",
    });

    expect(result.intent.intent).toBe("answer_question");
    expect(
      logSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("step=classify_intent") &&
          String(call[0]).includes("result=ok"),
      ),
    ).toBe(true);
    expect(
      errorSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("step=append_legacy_chatbook") &&
          String(call[0]).includes("result=fail"),
      ),
    ).toBe(true);
    expect(
      warnSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("step=append_legacy_chatbook") &&
          String(call[0]).includes("result=skip"),
      ),
    ).toBe(true);
  });
});
