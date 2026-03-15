import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  generateModelObjectMock,
  generateModelTextMock,
  getContextWindowInfoMock,
  getLastTokenUsageMock,
  ensureSuperV1PostgresReadyMock,
} = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
  generateModelTextMock: vi.fn(),
  getContextWindowInfoMock: vi.fn(() => ({
    modelUsed: "mock-model",
    provider: "mock",
    maxContextTokens: 100000,
    usedTokens: 3200,
    utilizationPercent: 3.2,
    breakdown: {
      systemPromptTokens: 500,
      userPromptTokens: 700,
      completionTokens: 2000,
    },
    estimatedCostUsd: 0.0042,
  })),
  getLastTokenUsageMock: vi.fn(() => ({
    promptTokens: 1200,
    completionTokens: 2000,
    totalTokens: 3200,
  })),
  ensureSuperV1PostgresReadyMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
  generateModelText: generateModelTextMock,
  getContextWindowInfo: getContextWindowInfoMock,
  getLastTokenUsage: getLastTokenUsageMock,
}));

vi.mock("@/server/superv1/db-preflight", () => ({
  ensureSuperV1PostgresReady: ensureSuperV1PostgresReadyMock,
}));

describe("superv1 API routes", () => {
  beforeEach(() => {
    generateModelObjectMock.mockReset();
    generateModelTextMock.mockReset();
    getContextWindowInfoMock.mockClear();
    getLastTokenUsageMock.mockClear();
    ensureSuperV1PostgresReadyMock.mockReset();
    ensureSuperV1PostgresReadyMock.mockResolvedValue(undefined);
  });

  test("start -> turn -> state -> turns contract works", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { POST: startPost } = await import("../app/api/conversations/start/route");
    const startResponse = await startPost();
    const startData = await startResponse.json();

    expect(startResponse.status).toBe(200);
    expect(typeof startData.conversationId).toBe("string");

    generateModelObjectMock
      .mockResolvedValueOnce({
        intent: "answer_question",
        confidence: 0.93,
        reason: "User answered directly",
      })
      .mockResolvedValueOnce({
        filled_items: [
          {
            question_id: "cp_what_does_company_do",
            value: "We help teams find internal docs.",
            confidence: 0.9,
            evidence: "We help teams find internal docs.",
          },
        ],
        ambiguous_items: [],
        possible_items: [],
      });
    generateModelTextMock.mockResolvedValueOnce("Captured. Next key question: Who is the primary audience?");

    const { POST: turnPost } = await import("../app/api/turn/route");
    const turnRequest = new NextRequest("http://localhost/api/turn", {
      method: "POST",
      body: JSON.stringify({
        conversationId: startData.conversationId,
        userMessage: "We help teams find internal docs.",
        language: "en",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const turnResponse = await turnPost(turnRequest);
    const turnData = await turnResponse.json();
    expect(turnResponse.status).toBe(200);
    expect(typeof turnData.reply).toBe("string");
    expect(turnData.conversationId).toBe(startData.conversationId);
    expect(turnData.interaction.mode_before).toBe("interviewing");
    expect(turnData.interaction.mode_after).toBe("interviewing");
    expect(
      logSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("runtime=route.superv1.turn") &&
          String(call[0]).includes("phase=run") &&
          String(call[0]).includes("event=start"),
      ),
    ).toBe(true);
    expect(
      logSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("runtime=route.superv1.turn") &&
          String(call[0]).includes("phase=run") &&
          String(call[0]).includes("result=ok"),
      ),
    ).toBe(true);

    const { GET: stateGet } = await import("../app/api/conversations/[id]/state/route");
    const stateResponse = await stateGet(new Request("http://localhost"), {
      params: Promise.resolve({ id: startData.conversationId }),
    });
    const stateData = await stateResponse.json();
    expect(stateResponse.status).toBe(200);
    expect(stateData.state.conversationId).toBe(startData.conversationId);
    expect(stateData.state.interaction_mode).toBe("interviewing");

    const { GET: turnsGet } = await import("../app/api/conversations/[id]/turns/route");
    const turnsResponse = await turnsGet(new Request("http://localhost"), {
      params: Promise.resolve({ id: startData.conversationId }),
    });
    const turnsData = await turnsResponse.json();
    expect(turnsResponse.status).toBe(200);
    expect(Array.isArray(turnsData.turns)).toBe(true);
    expect(turnsData.turns.length).toBeGreaterThanOrEqual(2);
  });

  test("audit endpoint enforces admin token", async () => {
    const { POST: startPost } = await import("../app/api/conversations/start/route");
    const started = await (await startPost()).json();
    generateModelObjectMock.mockResolvedValueOnce({
      intent: "ask_for_help",
      confidence: 0.9,
      reason: "Needs help",
    });
    generateModelTextMock.mockResolvedValueOnce("Let's unpack this question.");
    const { POST: turnPost } = await import("../app/api/turn/route");
    await turnPost(
      new NextRequest("http://localhost/api/turn", {
        method: "POST",
        body: JSON.stringify({
          conversationId: started.conversationId,
          userMessage: "I don't understand this question.",
          language: "en",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    process.env.INTERVIEW_TRACE_ADMIN_KEY = "superv1-admin";
    const { GET: auditGet } = await import("../app/api/conversations/[id]/audit/route");

    const unauthorized = await auditGet(
      new NextRequest("http://localhost/api/conversations/x/audit", { method: "GET" }),
      { params: Promise.resolve({ id: started.conversationId }) },
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await auditGet(
      new NextRequest("http://localhost/api/conversations/x/audit", {
        method: "GET",
        headers: { "x-admin-token": "superv1-admin" },
      }),
      { params: Promise.resolve({ id: started.conversationId }) },
    );
    expect(authorized.status).toBe(200);
    const payload = await authorized.json();
    expect(Array.isArray(payload.routing_events)).toBe(true);
    expect(payload.routing_events.length).toBeGreaterThan(0);
  });

  test("/api/turn logs fail envelope for invalid payload", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST: turnPost } = await import("../app/api/turn/route");
    const badRequest = new NextRequest("http://localhost/api/turn", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "not-a-uuid",
        userMessage: "",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await turnPost(badRequest);
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(typeof data.error).toBe("string");
    expect(
      errorSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("runtime=route.superv1.turn") &&
          String(call[0]).includes("result=fail"),
      ),
    ).toBe(true);
  });

  test("/api/conversations/start returns schema-missing code when preflight fails", async () => {
    ensureSuperV1PostgresReadyMock.mockRejectedValueOnce(
      new Error("relation conversations does not exist"),
    );
    const { POST: startPost } = await import("../app/api/conversations/start/route");
    const response = await startPost();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe("SUPERV1_SCHEMA_MISSING");
    expect(typeof data.error).toBe("string");
  });

  test("list and delete conversations endpoints work", async () => {
    const { POST: startPost } = await import("../app/api/conversations/start/route");
    const started = await (await startPost()).json();

    const { GET: listGet } = await import("../app/api/conversations/route");
    const listResponse = await listGet();
    const listData = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listData.conversations)).toBe(true);
    expect(
      listData.conversations.some(
        (row: { id: string }) => row.id === started.conversationId,
      ),
    ).toBe(true);

    const { POST: deletePost } = await import("../app/api/conversations/delete/route");
    const deleteResponse = await deletePost(
      new NextRequest("http://localhost/api/conversations/delete", {
        method: "POST",
        body: JSON.stringify({ conversationId: started.conversationId }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const deleteData = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteData.ok).toBe(true);
  });
});
