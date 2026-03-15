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
    expect(result.interaction.mode_after).toBe("help_open");
    expect(result.interaction.help_transition).toBe("enter_help");
    expect(after.map((entry) => entry.status)).toEqual(before.map((entry) => entry.status));
  });

  test("help mode keeps selection-only turns in ask_for_help and stays open", async () => {
    const started = await startSuperV1Conversation();
    const controller = getSuperV1TurnController();
    const repo = getSuperV1Repository();

    generateModelObjectMock.mockResolvedValueOnce({
      intent: "ask_for_help",
      confidence: 0.91,
      reason: "User asks for help",
    });
    generateModelTextMock.mockResolvedValueOnce("I'll help you answer this.");
    await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "Can you help me answer this?",
      language: "en",
    });

    generateModelObjectMock.mockResolvedValueOnce({
      intent: "other_discussion",
      confidence: 0.7,
      reason: "Ambiguous short turn",
    });
    generateModelTextMock.mockResolvedValueOnce("You selected option 2. I can expand that.");

    const second = await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "2",
      language: "en",
    });

    const convo = await repo.getConversation(started.conversationId);
    expect(second.intent.intent).toBe("ask_for_help");
    expect(second.interaction.mode_before).toBe("help_open");
    expect(second.interaction.mode_after).toBe("help_open");
    expect(second.interaction.help_transition).toBe("stay_help");
    expect(second.interaction.detected_help_selection?.detected).toBe(true);
    expect(convo?.interaction_mode).toBe("help_open");
  });

  test("help mode exits cleanly when user provides answer content", async () => {
    const started = await startSuperV1Conversation();
    const controller = getSuperV1TurnController();
    const repo = getSuperV1Repository();

    generateModelObjectMock.mockResolvedValueOnce({
      intent: "ask_for_help",
      confidence: 0.92,
      reason: "User asks for help",
    });
    generateModelTextMock.mockResolvedValueOnce("Let's break it down.");
    await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "I don't understand this question.",
      language: "en",
    });

    generateModelObjectMock
      .mockResolvedValueOnce({
        intent: "ask_for_help",
        confidence: 0.65,
        reason: "Tentative",
      })
      .mockResolvedValueOnce({
        filled_items: [
          {
            question_id: "cp_what_does_company_do",
            value: "We are an AI search system for enterprise docs.",
            confidence: 0.9,
            evidence: "AI search system for enterprise docs",
          },
        ],
        ambiguous_items: [],
        possible_items: [],
      });
    generateModelTextMock.mockResolvedValueOnce("Captured. Next key question: What category fits best?");

    const second = await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "I think it's an AI search system for enterprise docs.",
      language: "en",
    });

    const convo = await repo.getConversation(started.conversationId);
    const answers = await repo.listAnswers(started.conversationId);
    const answered = answers.find((row) => row.question_id === "cp_what_does_company_do");

    expect(second.intent.intent).toBe("answer_question");
    expect(second.interaction.mode_before).toBe("help_open");
    expect(second.interaction.mode_after).toBe("interviewing");
    expect(second.interaction.help_transition).toBe("exit_help");
    expect(convo?.interaction_mode).toBe("interviewing");
    expect(convo?.help_context_json).toBe(null);
    expect(answered?.status).toBe("filled");
  });

  test("other_discussion does not mutate checklist answers", async () => {
    const started = await startSuperV1Conversation();
    const controller = getSuperV1TurnController();
    const repo = getSuperV1Repository();
    const before = await repo.listAnswers(started.conversationId);

    generateModelObjectMock.mockResolvedValueOnce({
      intent: "other_discussion",
      confidence: 0.88,
      reason: "Side discussion",
    });
    generateModelTextMock.mockResolvedValueOnce("Sure, quick side note and then we'll return.");

    const result = await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "By the way, summarize what we have so far.",
      language: "en",
    });

    const after = await repo.listAnswers(started.conversationId);
    expect(result.intent.intent).toBe("other_discussion");
    expect(after.map((entry) => entry.status)).toEqual(before.map((entry) => entry.status));
  });

  test("help_open keeps chinese clarification in ask_for_help even when classifier says answer", async () => {
    const started = await startSuperV1Conversation();
    const controller = getSuperV1TurnController();
    const repo = getSuperV1Repository();

    generateModelObjectMock.mockResolvedValueOnce({
      intent: "ask_for_help",
      confidence: 0.9,
      reason: "Needs help",
    });
    generateModelTextMock.mockResolvedValueOnce("当然，我们先把这个问题拆开。");

    await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "我不太懂这个问题，可以解释一下吗？",
      language: "zh",
    });

    const before = await repo.listAnswers(started.conversationId);

    generateModelObjectMock.mockResolvedValueOnce({
      intent: "answer_question",
      confidence: 0.88,
      reason: "Model misread this as answer",
    });
    generateModelTextMock.mockResolvedValueOnce("我来再解释一次这个问题的含义。");

    const result = await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "有点不懂你这个问题的意思，什么叫我们公司成立初衷？",
      language: "zh",
    });

    const after = await repo.listAnswers(started.conversationId);
    const conversation = await repo.getConversation(started.conversationId);

    expect(result.intent.intent).toBe("ask_for_help");
    expect(result.interaction.mode_before).toBe("help_open");
    expect(result.interaction.mode_after).toBe("help_open");
    expect(result.interaction.help_transition).toBe("stay_help");
    expect(after.map((entry) => entry.status)).toEqual(before.map((entry) => entry.status));
    expect(conversation?.interaction_mode).toBe("help_open");
  });

  test("help_open exits on short chinese slot-aligned answer via extraction probe", async () => {
    const started = await startSuperV1Conversation();
    const controller = getSuperV1TurnController();
    const repo = getSuperV1Repository();

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
            value: "我们提供企业文档检索 API 服务。",
            confidence: 0.9,
            evidence: "企业文档检索 API 服务",
          },
        ],
        ambiguous_items: [],
        possible_items: [],
      });
    generateModelTextMock.mockResolvedValueOnce("收到，我们继续。");
    await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "我们提供企业文档检索 API 服务。",
      language: "zh",
    });

    generateModelObjectMock.mockResolvedValueOnce({
      intent: "ask_for_help",
      confidence: 0.9,
      reason: "Need clarification",
    });
    generateModelTextMock.mockResolvedValueOnce("我先解释一下类别怎么选。");
    await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "有点不明白有哪些类别",
      language: "zh",
    });

    generateModelObjectMock
      .mockResolvedValueOnce({
        intent: "ask_for_help",
        confidence: 0.72,
        reason: "Ambiguous short sentence",
      })
      .mockResolvedValueOnce({
        filled_items: [
          {
            question_id: "cp_category",
            value: "API 服务类别",
            confidence: 0.88,
            evidence: "属于api服务类别",
          },
        ],
        ambiguous_items: [],
        possible_items: [],
      });
    generateModelTextMock.mockResolvedValueOnce("已记录类别，我们继续下一题。");

    const result = await controller.handleUserTurn({
      conversationId: started.conversationId,
      userMessage: "那我们属于api服务类别，针对企业用户",
      language: "zh",
    });

    const conversation = await repo.getConversation(started.conversationId);
    const answers = await repo.listAnswers(started.conversationId);
    const categoryAnswer = answers.find((row) => row.question_id === "cp_category");

    expect(result.intent.intent).toBe("answer_question");
    expect(result.interaction.mode_before).toBe("help_open");
    expect(result.interaction.mode_after).toBe("interviewing");
    expect(result.interaction.help_transition).toBe("exit_help");
    expect(conversation?.interaction_mode).toBe("interviewing");
    expect(categoryAnswer?.status).toBe("filled");
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
