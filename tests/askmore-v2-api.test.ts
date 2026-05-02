import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { ensureAskmoreV2PostgresReadyMock } = vi.hoisted(() => ({
  ensureAskmoreV2PostgresReadyMock: vi.fn(),
}));

vi.mock("@/server/askmore_v2/db-preflight", () => ({
  ensureAskmoreV2PostgresReady: ensureAskmoreV2PostgresReadyMock,
}));

import {
  getAskmoreV2Repository,
  resetAskmoreV2RepositoryForTests,
} from "@/server/askmore_v2/repo";
import { resetAskmoreV2MemoryStore } from "@/server/askmore_v2/repo/memory-repo";
import { eventsToResponseBlocks } from "@/server/askmore_v2/events/event-builder";

type QuestionCard = {
  question_id: string;
  original_question: string;
  analysis: {
    evaluation: {
      is_too_broad: boolean;
      is_too_abstract: boolean;
      difficulty: "low" | "medium" | "high";
    };
    reason: string;
  };
  ai_candidate: {
    entry_question: string;
    sub_questions: string[];
    example_answer_styles: string[];
    recommended_strategy: string;
  };
  selection: {
    mode: "use_original" | "use_ai_refined" | "custom_manual";
  };
  final_payload: {
    source_mode: "use_original" | "use_ai_refined" | "custom_manual";
    entry_question: string;
    sub_questions: string[];
    example_answer_styles: string[];
    recommended_strategy: string;
  };
};

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.VITEST = "true";
  delete process.env.DATABASE_URL;

  resetAskmoreV2RepositoryForTests();
  resetAskmoreV2MemoryStore();
  ensureAskmoreV2PostgresReadyMock.mockReset();
  ensureAskmoreV2PostgresReadyMock.mockResolvedValue(undefined);
});

describe("askmore v2 API contracts", () => {
  test("builder review -> publish -> active-flow", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");

    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: [
            "你的公司愿景是什么？",
            "你最希望客户记住你的什么特点？",
            "你现在最主要的业务重点是什么？",
          ],
          scenario: "咨询 intake",
          target_output_type: "结构化总结",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    expect(reviewResponse.status).toBe(200);
    expect(Array.isArray(reviewData.cards)).toBe(true);
    expect(reviewData.cards.length).toBe(3);

    const cards = reviewData.cards as QuestionCard[];

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    const publishResponse = await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards,
          raw_questions: cards.map((item) => item.original_question),
          scenario: "咨询 intake",
          target_output_type: "结构化总结",
          language: "zh",
        }),
      }),
    );
    const publishData = await publishResponse.json();

    expect(publishResponse.status).toBe(200);
    expect(publishData.status).toBe("published");
    expect(typeof publishData.flow_version_id).toBe("string");
    expect(publishData.version).toBe(1);

    const { GET: activeGet } = await import("../app/api/askmore_v2/builder/active-flow/route");
    const activeResponse = await activeGet(
      new NextRequest("http://localhost/api/askmore_v2/builder/active-flow"),
    );
    const activeData = await activeResponse.json();

    expect(activeResponse.status).toBe(200);
    expect(activeData.flow).not.toBeNull();
    expect(activeData.flow.version).toBe(1);
    expect(activeData.flow.status).toBe("published");
    expect(Array.isArray(activeData.flow.flow_jsonb.cards_snapshot)).toBe(true);
    expect(Array.isArray(activeData.flow.flow_jsonb.final_flow_questions)).toBe(true);
  });

  test("publish rejects custom_manual card when final_payload is incomplete", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();
    const cards = reviewData.cards as QuestionCard[];
    cards[0] = {
      ...cards[0],
      selection: { mode: "custom_manual" },
      final_payload: {
        ...cards[0].final_payload,
        source_mode: "custom_manual",
        entry_question: "",
        sub_questions: [],
        example_answer_styles: [],
        recommended_strategy: "",
      },
    };

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    const publishResponse = await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards,
          raw_questions: ["问题1", "问题2"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const publishData = await publishResponse.json();

    expect(publishResponse.status).toBe(400);
    expect(String(publishData.error || "")).toContain("custom_manual");
  });

  test("interview start -> turn -> summary contract", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3", "问题4"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3", "问题4"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startResponse = await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    );
    const startData = await startResponse.json();

    expect(startResponse.status).toBe(200);
    expect(typeof startData.session_id).toBe("string");
    expect(typeof startData.opening_turn).toBe("string");

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const turnResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "11111111-1111-4111-8111-111111111111",
          user_message: "我们主要服务中小企业老板",
          language: "zh",
        }),
      }),
    );
    const turnData = await turnResponse.json();

    expect(turnResponse.status).toBe(200);
    expect(typeof turnData.session_id).toBe("string");
    expect(typeof turnData.turn_id).toBe("string");
    expect(typeof turnData.state).toBe("object");
    expect(typeof turnData.routed_intent).toBe("object");
    expect(Array.isArray(turnData.events)).toBe(true);
    expect(Array.isArray(turnData.response_blocks)).toBe(true);
    expect(turnData.assistant_message).toBeUndefined();
    expect(turnData.status).toBeUndefined();
    expect(turnData.turn_count).toBeUndefined();

    const { POST: summaryPost } = await import("../app/api/askmore_v2/interview/summary/route");
    const summaryResponse = await summaryPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          mode: "progressive",
          language: "zh",
        }),
      }),
    );
    const summaryData = await summaryResponse.json();

    expect(summaryResponse.status).toBe(200);
    expect(typeof summaryData.summary_text).toBe("string");
    expect(typeof summaryData.structured_report_json).toBe("object");
  });

  test("interview turn supports stream=1 and returns phase/final events", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startData = await (await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    )).json();

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const streamResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "12121212-1212-4212-8212-121212121212",
          user_message: "补充一点背景信息",
          language: "zh",
        }),
      }),
    );

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("application/x-ndjson");

    const raw = await streamResponse.text();
    const events = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as {
        type: "phase" | "final" | "error";
        phase?: string;
        status?: "start" | "done";
        payload?: {
          session_id: string;
          turn_id: string;
          events: unknown[];
        };
      });

    const phaseEvents = events.filter((event) => event.type === "phase");
    const finalEvent = events.find((event) => event.type === "final");

    expect(phaseEvents.length).toBeGreaterThan(0);
    expect(phaseEvents.some((event) => event.phase === "assemble_context" && event.status === "start")).toBe(true);
    expect(phaseEvents.some((event) => event.phase === "persist_and_finalize" && event.status === "done")).toBe(true);
    expect(finalEvent).toBeTruthy();
    expect(finalEvent?.payload?.session_id).toBe(startData.session_id);
    expect(typeof finalEvent?.payload?.turn_id).toBe("string");
    expect(Array.isArray(finalEvent?.payload?.events)).toBe(true);
  });

  test("interview turn keeps minimal contract when user sends summary shortcut text", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startResponse = await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    );
    const startData = await startResponse.json();

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const turnResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "22222222-2222-4222-8222-222222222222",
          user_message: "先看总结",
          language: "zh",
        }),
      }),
    );
    const turnData = await turnResponse.json();

    expect(turnResponse.status).toBe(200);
    expect(turnData.routed_intent.intent).toBe("answer_question");
    expect(typeof turnData.turn_id).toBe("string");
    expect(Array.isArray(turnData.events)).toBe(true);
    expect(turnData.state.session.finalized).toBe(false);
    expect(Array.isArray(turnData.response_blocks)).toBe(true);
    expect(turnData.summary_text).toBeUndefined();
  });

  test("interview turn accepts optional choice payload", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startResponse = await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    );
    const startData = await startResponse.json();

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const turnResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "33333333-3333-4333-8333-333333333333",
          user_message: "已选择：局部小块",
          language: "zh",
          choice: {
            dimension_id: "dimension_topic_1",
            option_id: "A",
            option_label: "局部小块",
          },
        }),
      }),
    );
    const turnData = await turnResponse.json();

    expect(turnResponse.status).toBe(200);
    expect(Array.isArray(turnData.response_blocks)).toBe(true);
  });

  test("answer follow-up can expose follow_up_select mode and validates mismatched choice_kind", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "宠物健康咨询",
          target_output_type: "问诊记录",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "宠物健康咨询",
          target_output_type: "问诊记录",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startData = await (await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    )).json();

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const firstTurnResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "33333333-3333-4333-8333-333333333334",
          user_message: "最近一周开始有点异常",
          language: "zh",
        }),
      }),
    );
    const firstTurnData = await firstTurnResponse.json();
    expect(firstTurnResponse.status).toBe(200);

    const followUpEvent = (firstTurnData.events ?? []).find((event: {
      event_id: string;
      event_type: string;
      payload?: {
        mode?: string;
        options?: Array<{ option_id: string; label: string }>;
        dimension_id?: string;
      };
    }) => (
      event.event_type === "next_step"
      && event.payload?.mode === "follow_up_select"
      && (event.payload?.options ?? []).length >= 2
      && typeof event.payload?.dimension_id === "string"
    ));

    expect(followUpEvent).toBeTruthy();
    if (!followUpEvent) return;

    const invalidChoiceResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "33333333-3333-4333-8333-333333333335",
          user_message: "已选择",
          language: "zh",
          choice: {
            dimension_id: followUpEvent.payload?.dimension_id,
            option_id: followUpEvent.payload?.options?.[0]?.option_id,
            option_label: followUpEvent.payload?.options?.[0]?.label,
            choice_kind: "micro_confirm",
            source_event_id: followUpEvent.event_id,
          },
        }),
      }),
    );
    const invalidData = await invalidChoiceResponse.json();
    expect(invalidChoiceResponse.status).toBe(400);
    expect(String(invalidData.error ?? "")).toContain("choice_kind mismatch");
  });

  test("in-progress session stays bound to original flow version after new publish", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");

    const reviewV1Response = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["v1 问题1", "v1 问题2", "v1 问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewV1 = await reviewV1Response.json();

    const publishV1Response = await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewV1.cards,
          raw_questions: ["v1 问题1", "v1 问题2", "v1 问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const publishV1 = await publishV1Response.json();

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startResponse = await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    );
    const started = await startResponse.json();

    const reviewV2Response = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["v2 新问题1", "v2 新问题2", "v2 新问题3"],
          scenario: "销售",
          target_output_type: "新报告",
          language: "zh",
        }),
      }),
    );
    const reviewV2 = await reviewV2Response.json();

    const publishV2Response = await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewV2.cards,
          raw_questions: ["v2 新问题1", "v2 新问题2", "v2 新问题3"],
          scenario: "销售",
          target_output_type: "新报告",
          language: "zh",
        }),
      }),
    );
    const publishV2 = await publishV2Response.json();

    expect(publishV2.version).toBe(2);

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const turnResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: started.session_id,
          client_turn_id: "44444444-4444-4444-8444-444444444444",
          user_message: "旧会话继续回答",
          language: "zh",
        }),
      }),
    );

    expect(turnResponse.status).toBe(200);

    const repo = getAskmoreV2Repository();
    const session = await repo.getSession(started.session_id);

    expect(session).not.toBeNull();
    expect(session?.flow_version_id).toBe(publishV1.flow_version_id);
    expect(session?.flow_version_id).not.toBe(publishV2.flow_version_id);
  });

  test("interview sessions list/load/delete APIs work and preserve contract", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const started1 = await (await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    )).json();
    const started2 = await (await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    )).json();

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: started1.session_id,
          client_turn_id: "55555555-5555-4555-8555-555555555555",
          user_message: "先补充一条信息",
          language: "zh",
        }),
      }),
    );

    const { GET: sessionsGet } = await import("../app/api/askmore_v2/interview/sessions/route");
    const sessionsResponse = await sessionsGet(
      new NextRequest("http://localhost/api/askmore_v2/interview/sessions?limit=100", {
        method: "GET",
      }),
    );
    const sessionsData = await sessionsResponse.json();

    expect(sessionsResponse.status).toBe(200);
    expect(Array.isArray(sessionsData.sessions)).toBe(true);
    expect(sessionsData.sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessionsData.sessions[0].id).toBe(started1.session_id);
    expect(typeof sessionsData.sessions[0].current_question_id === "string" || sessionsData.sessions[0].current_question_id === null).toBe(true);

    const { GET: sessionDetailGet } = await import("../app/api/askmore_v2/interview/sessions/[id]/route");
    const detailResponse = await sessionDetailGet(
      new NextRequest(`http://localhost/api/askmore_v2/interview/sessions/${started1.session_id}`, {
        method: "GET",
      }),
      { params: Promise.resolve({ id: started1.session_id }) },
    );
    const detailData = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailData.session.id).toBe(started1.session_id);
    expect(Array.isArray(detailData.messages)).toBe(true);
    expect(detailData.messages.length).toBeGreaterThan(0);
    expect(Array.isArray(detailData.flow_questions) || detailData.flow_questions === null).toBe(true);

    const { POST: deletePost } = await import("../app/api/askmore_v2/interview/sessions/delete/route");
    const deleteResponse = await deletePost(
      new NextRequest("http://localhost/api/askmore_v2/interview/sessions/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: started1.session_id }),
      }),
    );
    const deleteData = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteData.deleted).toBe(true);

    const deletedDetailResponse = await sessionDetailGet(
      new NextRequest(`http://localhost/api/askmore_v2/interview/sessions/${started1.session_id}`, {
        method: "GET",
      }),
      { params: Promise.resolve({ id: started1.session_id }) },
    );
    expect(deletedDetailResponse.status).toBe(404);

    const missingDeleteResponse = await deletePost(
      new NextRequest("http://localhost/api/askmore_v2/interview/sessions/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: started1.session_id }),
      }),
    );
    expect(missingDeleteResponse.status).toBe(404);
    expect(started2.session_id).toBeTruthy();
  });

  test("turn response exposes routed intent + events as primary source", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startResponse = await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    );
    const startData = await startResponse.json();

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const turnResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "66666666-6666-4666-8666-666666666666",
          user_message: "我们主要做企业数字化咨询",
          language: "zh",
        }),
      }),
    );
    const turnData = await turnResponse.json();

    expect(turnResponse.status).toBe(200);
    expect(turnData.routed_intent).toBeTruthy();
    expect(["answer_question", "ask_for_help", "clarify_meaning", "other_discussion"]).toContain(turnData.routed_intent.intent);
    expect(typeof turnData.routed_intent.confidence).toBe("number");
    expect(Array.isArray(turnData.events)).toBe(true);
    expect(Array.isArray(turnData.debug_events)).toBe(true);
    expect(turnData.events.length).toBeGreaterThan(0);
    expect(turnData.events.length).toBeGreaterThanOrEqual(2);
    expect(turnData.events.length).toBeLessThanOrEqual(4);

    const allowedEventTypes = new Set([
      "understanding",
      "acknowledgement",
      "why_this_matters",
      "gentle_gap_prompt",
      "help_explanation",
      "help_examples",
      "micro_confirm",
      "transition",
      "next_step",
    ]);
    const allowedDebugEventTypes = new Set([
      "understanding_summary",
      "state_update",
      "coverage_summary",
      "gap_notice",
      "help_explanation",
      "help_examples",
      "micro_confirm",
      "transition_summary",
      "next_question",
    ]);
    for (const event of turnData.events) {
      expect(typeof event.event_id).toBe("string");
      expect(allowedEventTypes.has(event.event_type)).toBe(true);
      expect(typeof event.created_at).toBe("string");
      expect(typeof event.visible).toBe("boolean");
    }
    const visibleText = turnData.events
      .map((event: { payload?: { content?: string } }) => event.payload?.content ?? "")
      .join(" ");
    expect(visibleText).not.toMatch(/\b\d+\s*\/\s*\d+\b/);
    expect(visibleText).not.toMatch(/已记录[:：]\s*[^。]*=/);
    for (const event of turnData.debug_events) {
      expect(typeof event.event_id).toBe("string");
      expect(allowedDebugEventTypes.has(event.event_type)).toBe(true);
      expect(typeof event.created_at).toBe("string");
      expect(typeof event.visible).toBe("boolean");
    }

    expect(turnData.response_blocks).toEqual(eventsToResponseBlocks(turnData.events));
    expect(turnData.state.session.pending_intent).toBe(turnData.routed_intent.intent);
    expect(Array.isArray(turnData.state.session.pending_commitments)).toBe(true);
    expect(turnData.state.runtime_meta).toBeTruthy();
    expect(typeof turnData.state.runtime_meta.last_task_module).toBe("string");
    expect("assistant_message" in turnData).toBe(false);
    expect("understanding_feedback" in turnData).toBe(false);
    expect("answer_status" in turnData).toBe(false);
    expect("missing_points" in turnData).toBe(false);
    expect("suggested_next_action" in turnData).toBe(false);
    expect("summary_text" in turnData).toBe(false);
    expect("structured_report_json" in turnData).toBe(false);
  });

  test("turn replay with same client_turn_id is idempotent and does not duplicate writes", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startResponse = await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    );
    const startData = await startResponse.json();

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const turnRequestBody = {
      session_id: startData.session_id,
      client_turn_id: "77777777-7777-4777-8777-777777777777",
      user_message: "我们的客户主要是制造业中小企业",
      language: "zh",
    };

    const repo = getAskmoreV2Repository();
    const beforeMessages = await repo.listMessages(startData.session_id);
    const beforeEvents = await repo.listTurnEvents(startData.session_id);

    const firstResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(turnRequestBody),
      }),
    );
    const firstData = await firstResponse.json();
    expect(firstResponse.status).toBe(200);

    const middleMessages = await repo.listMessages(startData.session_id);
    const middleEvents = await repo.listTurnEvents(startData.session_id);

    const secondResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...turnRequestBody,
          user_message: "这条消息会被幂等边界忽略",
        }),
      }),
    );
    const secondData = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondData.turn_id).toBe(firstData.turn_id);
    expect(secondData.routed_intent).toEqual(firstData.routed_intent);
    expect(secondData.events).toEqual(firstData.events);
    expect(secondData.debug_events).toEqual(firstData.debug_events);
    expect(secondData.response_blocks).toEqual(firstData.response_blocks);

    const afterMessages = await repo.listMessages(startData.session_id);
    const afterEvents = await repo.listTurnEvents(startData.session_id, undefined, "visible");
    const afterDebugEvents = await repo.listTurnEvents(startData.session_id, undefined, "internal");
    const storedTurnEvents = await repo.listTurnEvents(startData.session_id, firstData.turn_id);
    const storedDebugEvents = await repo.listTurnEvents(startData.session_id, firstData.turn_id, "internal");
    const commit = await repo.getTurnCommit(startData.session_id, turnRequestBody.client_turn_id);

    expect(middleMessages.length).toBe(beforeMessages.length + 2);
    expect(afterMessages.length).toBe(middleMessages.length);
    expect(middleEvents.length).toBeGreaterThan(beforeEvents.length);
    expect(afterEvents.length).toBe(middleEvents.length);
    expect(afterDebugEvents.length).toBeGreaterThan(0);
    expect(storedTurnEvents).toEqual(firstData.events);
    expect(storedDebugEvents).toEqual(firstData.debug_events);
    expect(commit?.turn_id).toBe(firstData.turn_id);
  });

  test("turn route backfills new runtime state fields for legacy-shaped session state", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startResponse = await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    );
    const startData = await startResponse.json();

    const repo = getAskmoreV2Repository();
    const session = await repo.getSession(startData.session_id);
    expect(session).not.toBeNull();
    if (!session) return;
    delete session.state_jsonb.session.pending_intent;
    delete session.state_jsonb.session.pending_commitments;
    delete session.state_jsonb.runtime_meta;
    session.updated_at = new Date().toISOString();
    await repo.updateSession(session);

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const turnResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "88888888-8888-4888-8888-888888888888",
          user_message: "补一条信息",
          language: "zh",
        }),
      }),
    );
    const turnData = await turnResponse.json();
    expect(turnResponse.status).toBe(200);
    expect(turnData.state.session.pending_intent).toBeTruthy();
    expect(Array.isArray(turnData.state.session.pending_commitments)).toBe(true);
    expect(turnData.state.runtime_meta).toBeTruthy();
    expect(typeof turnData.state.runtime_meta.last_task_module).toBe("string");
  });

  test("ask_for_help turn stays on current question and returns help events", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startData = await (await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    )).json();
    const questionBefore = startData.state.session.current_question_id;

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const turnResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "99999999-9999-4999-8999-999999999999",
          user_message: "尿尿的姿势有哪些呀？能给我一些例子描述吗",
          language: "zh",
        }),
      }),
    );
    const turnData = await turnResponse.json();

    expect(turnResponse.status).toBe(200);
    expect(turnData.routed_intent.intent).toBe("ask_for_help");
    expect(turnData.state.session.current_question_id).toBe(questionBefore);
    expect(turnData.next_question?.question_id ?? null).toBe(questionBefore);
    expect(turnData.events.some((event: { event_type: string }) => event.event_type === "help_explanation")).toBe(true);
    expect(turnData.events.some((event: { event_type: string }) => event.event_type === "help_examples")).toBe(true);
    expect(turnData.state.runtime_meta?.last_help_obstacle_layer).toBeTruthy();
    expect(turnData.state.runtime_meta?.last_help_resolution_goal).toBeTruthy();
    const debugHelp = turnData.debug_events.find((event: { event_type: string }) => event.event_type === "help_explanation");
    expect(typeof debugHelp?.payload?.content).toBe("string");
    expect(String(debugHelp?.payload?.content ?? "")).toContain("我先直接回应你这个疑问");
    expect(String(debugHelp?.payload?.content ?? "")).toContain("我先把问题降级成更容易回答的版本");
    const debugExamples = turnData.debug_events.find((event: { event_type: string }) => event.event_type === "help_examples");
    expect(Array.isArray(debugExamples?.payload?.items)).toBe(true);
    expect((debugExamples?.payload?.items ?? []).length).toBeGreaterThan(0);
    expect((debugExamples?.payload?.items ?? []).length).toBeLessThanOrEqual(2);
  });

  test("pending help mode keeps ask_for_help on follow-up question-like turns", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startData = await (await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    )).json();
    const questionBefore = startData.state.session.current_question_id;

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const first = await (await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          user_message: "这个怎么回答比较好？",
          language: "zh",
        }),
      }),
    )).json();
    const second = await (await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          user_message: "那还有别的例子吗？",
          language: "zh",
        }),
      }),
    )).json();

    expect(first.routed_intent.intent).toBe("ask_for_help");
    expect(second.routed_intent.intent).toBe("ask_for_help");
    expect(second.state.session.current_question_id).toBe(questionBefore);
    expect(typeof second.state.runtime_meta?.last_help_reconnect_target === "string" || typeof second.state.runtime_meta?.last_help_reconnect_target === "undefined").toBe(true);
  });

  test("clarify_meaning concept subtype resolves confusion before reconnecting mainline", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "宠物健康咨询",
          target_output_type: "问诊记录",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "宠物健康咨询",
          target_output_type: "问诊记录",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startData = await (await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    )).json();

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    const turnData = await (await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          user_message: "怎么判断紧张感呢？什么行为算呢？",
          language: "zh",
        }),
      }),
    )).json();

    expect(turnData.routed_intent.intent).toBe("clarify_meaning");
    const debugHelp = turnData.debug_events.find((event: { event_type: string }) => event.event_type === "help_explanation");
    expect(String(debugHelp?.payload?.content ?? "")).toContain("我先直接回应你这个疑问");
    expect(String(debugHelp?.payload?.content ?? "")).toContain("降级");
    expect(typeof turnData.next_question?.question_text).toBe("string");
    expect(String(turnData.next_question?.question_text ?? "")).toContain("最确定");
    expect(turnData.events.some((event: { event_type: string }) => event.event_type === "micro_confirm")).toBe(false);
    expect(turnData.state.runtime_meta?.last_clarify_subtype).toBe("concept_clarify");
  });

  test("micro_confirm is emitted by ClarificationAgent after answer handoff", async () => {
    const { POST: reviewPost } = await import("../app/api/askmore_v2/builder/review/route");
    const reviewResponse = await reviewPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );
    const reviewData = await reviewResponse.json();

    const { POST: publishPost } = await import("../app/api/askmore_v2/builder/publish/route");
    await publishPost(
      new NextRequest("http://localhost/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: reviewData.cards,
          raw_questions: ["问题1", "问题2", "问题3"],
          scenario: "咨询",
          target_output_type: "报告",
          language: "zh",
        }),
      }),
    );

    const { POST: startPost } = await import("../app/api/askmore_v2/interview/start/route");
    const startData = await (await startPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh" }),
      }),
    )).json();

    const { POST: turnPost } = await import("../app/api/askmore_v2/interview/turn/route");
    await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          user_message: "最近一周才出现",
          language: "zh",
        }),
      }),
    );

    const turnResponse = await turnPost(
      new NextRequest("http://localhost/api/askmore_v2/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: startData.session_id,
          client_turn_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          user_message: "你问的是乱尿几次还是尿尿几次？",
          language: "zh",
        }),
      }),
    );
    const turnData = await turnResponse.json();

    expect(turnResponse.status).toBe(200);
    expect(turnData.events.some((event: { event_type: string }) => event.event_type === "micro_confirm")).toBe(true);
    expect(turnData.state.runtime_meta?.last_task_module).toBe("ClarificationAgent");
  });

  test("session feedback can be saved and loaded with session detail", async () => {
    const repo = getAskmoreV2Repository();
    const { ensureRuntimeStateDefaults } = await import("../src/server/askmore_v2/runtime/context-engine");
    const sessionId = "77777777-7777-4777-8777-777777777777";

    await repo.createSession({
      id: sessionId,
      flow_version_id: "flow-test-feedback",
      workspace_id: "ws_default_beta",
      created_by_user_id: "user_test_beta",
      status: "in_progress",
      turn_count: 1,
      state_version: 1,
      state_jsonb: ensureRuntimeStateDefaults({
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
      } as any),
      created_at: "2026-04-20T00:00:00.000Z",
      updated_at: "2026-04-20T00:00:00.000Z",
    });
    await repo.addMessage({
      id: "msg-feedback-1",
      session_id: sessionId,
      role: "assistant",
      message_text: "测试消息",
      created_at: "2026-04-20T00:00:00.000Z",
    });

    const { POST: feedbackPost } = await import("../app/api/feedback/session/route");
    const feedbackResponse = await feedbackPost(
      new NextRequest("http://localhost/api/feedback/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          helpful: false,
          satisfaction_score: 2,
          goal_text: "想确认访谈总结是否足够清楚",
          issue_text: "回答有点泛，缺少具体建议。",
        }),
      }),
    );
    const feedbackData = await feedbackResponse.json();

    expect(feedbackResponse.status).toBe(200);
    expect(feedbackData.feedback.helpful).toBe(false);
    expect(feedbackData.feedback.satisfaction_score).toBe(2);

    const { GET: sessionDetailGet } = await import("../app/api/askmore_v2/interview/sessions/[id]/route");
    const detailResponse = await sessionDetailGet(
      new NextRequest(`http://localhost/api/askmore_v2/interview/sessions/${sessionId}`),
      {
        params: Promise.resolve({ id: sessionId }),
      },
    );
    const detailData = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailData.feedback).toMatchObject({
      helpful: false,
      satisfaction_score: 2,
      goal_text: "想确认访谈总结是否足够清楚",
      issue_text: "回答有点泛，缺少具体建议。",
    });
  });

});
