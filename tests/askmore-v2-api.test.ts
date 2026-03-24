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
    const activeResponse = await activeGet();
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
          user_message: "我们主要服务中小企业老板",
          language: "zh",
        }),
      }),
    );
    const turnData = await turnResponse.json();

    expect(turnResponse.status).toBe(200);
    expect(typeof turnData.understanding_feedback).toBe("string");
    expect(["complete", "partial", "off_topic"]).toContain(turnData.answer_status);
    expect(Array.isArray(turnData.example_answers)).toBe(true);
    expect(typeof turnData.assistant_message).toBe("string");
    expect(Array.isArray(turnData.response_blocks)).toBe(true);
    expect(typeof turnData.planner_action).toBe("string");
    expect(typeof turnData.node_progress).toBe("object");

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

  test("interview turn accepts immediate summary request without breaking session", async () => {
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
          user_message: "先看总结",
          language: "zh",
        }),
      }),
    );
    const turnData = await turnResponse.json();

    expect(turnResponse.status).toBe(200);
    expect(turnData.suggested_next_action).toBe("show_summary");
    expect(typeof turnData.summary_text).toBe("string");
    expect(turnData.status).toBe("in_progress");
    expect(turnData.state.session.finalized).toBe(false);
    expect(Array.isArray(turnData.response_blocks)).toBe(true);
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
});
