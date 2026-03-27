import { beforeEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";

const { ensureAskmoreV2PostgresReadyMock } = vi.hoisted(() => ({
  ensureAskmoreV2PostgresReadyMock: vi.fn(),
}));

vi.mock("@/server/askmore_v2/db-preflight", () => ({
  ensureAskmoreV2PostgresReady: ensureAskmoreV2PostgresReadyMock,
}));

import { getAskmoreV2Repository, resetAskmoreV2RepositoryForTests } from "@/server/askmore_v2/repo";
import { resetAskmoreV2MemoryStore } from "@/server/askmore_v2/repo/memory-repo";
import { AskmoreV2FlowVersion, AskmoreV2InsightRunRecord, AskmoreV2Session } from "@/server/askmore_v2/types";
import { tryAutoGenerateInsightOnCompletion } from "@/server/askmore_v2/insight/service";

function buildFlowVersion(): AskmoreV2FlowVersion {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    version: 1,
    status: "published",
    published_at: now,
    created_at: now,
    updated_at: now,
    flow_jsonb: {
      schema_version: 2,
      raw_questions: ["问题1"],
      scenario: "咨询 intake",
      target_output_type: "结构化总结报告",
      language: "zh",
      cards_snapshot: [
        {
          question_id: "q1",
          original_question: "问题1",
          analysis: {
            evaluation: {
              is_too_broad: false,
              is_too_abstract: false,
              difficulty: "medium",
            },
            reason: "ok",
          },
          ai_candidate: {
            entry_question: "入口问题1",
            sub_questions: ["子问题1"],
            example_answer_styles: ["一句话版"],
            recommended_strategy: "direct_then_clarify",
          },
          selection: { mode: "use_ai_refined" },
          final_payload: {
            entry_question: "入口问题1",
            sub_questions: ["子问题1"],
            example_answer_styles: ["一句话版"],
            recommended_strategy: "direct_then_clarify",
            source_mode: "use_ai_refined",
          },
        },
      ],
      final_flow_questions: [
        {
          question_id: "q1",
          original_question: "问题1",
          entry_question: "入口问题1",
          sub_questions: ["子问题1"],
          example_answer_styles: ["一句话版"],
          recommended_strategy: "direct_then_clarify",
          source_mode: "use_ai_refined",
        },
      ],
      review_generation_meta: {
        used_fallback: false,
        fallback_count: 0,
      },
    },
  };
}

function buildSession(flowVersionId: string, status: "in_progress" | "completed" = "in_progress"): AskmoreV2Session {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    flow_version_id: flowVersionId,
    status,
    turn_count: 3,
    state_version: 1,
    state_jsonb: {
      session: {
        current_question_id: status === "completed" ? null : "q1",
        current_sub_question_index: 0,
        summary_generated: status === "completed",
        finalized: status === "completed",
        pending_end_confirmation: false,
        last_missing_points: [],
        last_understanding_feedback: "已收到信息",
      },
      recent_user_turns: ["我们主要服务中小企业老板"],
      recent_dimension_prompts: [],
      nodes: {},
      node_runtime: {},
      question_progress: {
        q1: {
          question_id: "q1",
          status: status === "completed" ? "completed" : "partial",
          times_asked: 2,
          follow_up_count: 1,
          sub_questions_completed: [],
          sub_questions_remaining: [],
          coverage_score: 0.7,
        },
      },
      structured_knowledge: {
        q1__audience: {
          value: "中小企业老板",
          confidence: 0.86,
          confirmed: true,
          updated_at: now,
        },
      },
      latest_summary_text: status === "completed" ? "总结完成" : null,
      latest_structured_report: null,
      latest_ai_thinking: null,
      ai_thinking_meta: null,
    },
    created_at: now,
    updated_at: now,
  };
}

beforeEach(() => {
  process.env.VITEST = "true";
  delete process.env.DATABASE_URL;
  ensureAskmoreV2PostgresReadyMock.mockReset();
  ensureAskmoreV2PostgresReadyMock.mockResolvedValue(undefined);
  resetAskmoreV2RepositoryForTests();
  resetAskmoreV2MemoryStore();
});

describe("askmore v2 ai thinking API", () => {
  test("POST /insight rejects manual trigger before session completed", async () => {
    const repo = getAskmoreV2Repository();
    const flow = buildFlowVersion();
    await repo.createFlowVersion(flow);
    const session = buildSession(flow.id, "in_progress");
    await repo.createSession(session);

    const { POST } = await import("../app/api/askmore_v2/interview/insight/route");
    const postResponse = await POST(
      new NextRequest("http://localhost/api/askmore_v2/interview/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.id,
          force_regenerate: true,
        }),
      }),
    );
    const postData = await postResponse.json();
    expect(postResponse.status).toBe(400);
    expect(postData.error_code).toBe("ai_thinking_requires_completed_session");
  });

  test("POST /insight on completed session fails with prompt_not_configured and records run error", async () => {
    const repo = getAskmoreV2Repository();
    const flow = buildFlowVersion();
    await repo.createFlowVersion(flow);
    const session = buildSession(flow.id, "completed");
    await repo.createSession(session);
    await repo.addMessage({
      id: randomUUID(),
      session_id: session.id,
      role: "user",
      message_text: "最近主要问题是优先级混乱",
      created_at: new Date().toISOString(),
    });

    const { POST, GET } = await import("../app/api/askmore_v2/interview/insight/route");
    const postResponse = await POST(
      new NextRequest("http://localhost/api/askmore_v2/interview/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.id,
          force_regenerate: true,
        }),
      }),
    );
    const postData = await postResponse.json();
    expect(postResponse.status).toBe(400);
    if (postData.error_code) {
      expect(postData.error_code).toBe("prompt_not_configured");
    } else {
      expect(String(postData.error ?? "")).toContain("Model calls disabled");
    }

    const getResponse = await GET(
      new NextRequest(`http://localhost/api/askmore_v2/interview/insight?session_id=${session.id}&limit=10`),
    );
    const getData = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getData.latest).toBeTruthy();
    const latestError = String(getData.latest?.error_text ?? "");
    expect(latestError.length).toBeGreaterThan(0);
    expect(
      latestError.includes("prompt")
      || latestError.includes("Model calls disabled"),
    ).toBe(true);
    expect(getData.latest?.pack_trace_jsonb?.core_pack).toBe("core.ai_thinking.v2");
  });

  test("POST /insight async mode returns accepted job and exposes job status", async () => {
    const repo = getAskmoreV2Repository();
    const flow = buildFlowVersion();
    await repo.createFlowVersion(flow);
    const session = buildSession(flow.id, "completed");
    await repo.createSession(session);
    await repo.addMessage({
      id: randomUUID(),
      session_id: session.id,
      role: "user",
      message_text: "最近主要问题是优先级混乱",
      created_at: new Date().toISOString(),
    });

    const { POST } = await import("../app/api/askmore_v2/interview/insight/route");
    const { GET: GET_JOB } = await import("../app/api/askmore_v2/interview/insight/job/route");

    const postResponse = await POST(
      new NextRequest("http://localhost/api/askmore_v2/interview/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.id,
          force_regenerate: true,
          async_mode: true,
        }),
      }),
    );
    const postData = await postResponse.json();
    expect(postResponse.status).toBe(202);
    expect(postData.accepted).toBe(true);
    expect(typeof postData.job_meta?.job_id).toBe("string");

    const jobResponse = await GET_JOB(
      new NextRequest(`http://localhost/api/askmore_v2/interview/insight/job?job_id=${postData.job_meta.job_id}`),
    );
    const jobData = await jobResponse.json();
    expect(jobResponse.status).toBe(200);
    expect(["running", "succeeded", "failed"]).toContain(jobData.job_meta?.status);
  });

  test("GET /insight filters out legacy v1 runs", async () => {
    const repo = getAskmoreV2Repository();
    const flow = buildFlowVersion();
    await repo.createFlowVersion(flow);
    const session = buildSession(flow.id, "completed");
    await repo.createSession(session);

    const now = new Date().toISOString();
    const legacyRun: AskmoreV2InsightRunRecord = {
      id: randomUUID(),
      session_id: session.id,
      trigger_source: "manual",
      domain: "business",
      subdomain: "general_strategy",
      language: "zh",
      pack_trace_jsonb: {
        core_pack: "core.insight.v1",
        domain_pack: "business.general.v1",
        subdomain_packs: [],
        style_pack: "style.direct_advisor.v1",
        safety_pack: "safety.standard.v1",
      },
      input_snapshot_jsonb: {},
      result_jsonb: null,
      quality_flags_jsonb: null,
      error_text: "legacy",
      created_at: now,
    };
    await repo.createInsightRun(legacyRun);
    await repo.createInsightRun({
      ...legacyRun,
      id: randomUUID(),
      pack_trace_jsonb: {
        ...legacyRun.pack_trace_jsonb,
        core_pack: "core.ai_thinking.v2",
        domain_pack: "business.general.v2",
      },
      error_text: "new",
    });

    const { GET } = await import("../app/api/askmore_v2/interview/insight/route");
    const getResponse = await GET(
      new NextRequest(`http://localhost/api/askmore_v2/interview/insight?session_id=${session.id}&limit=10`),
    );
    const getData = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(Array.isArray(getData.history)).toBe(true);
    expect(getData.history.length).toBe(1);
    expect(getData.history[0]?.pack_trace_jsonb?.core_pack).toBe("core.ai_thinking.v2");
  });

  test("auto generation on completion does not throw and persists latest error", async () => {
    const repo = getAskmoreV2Repository();
    const flow = buildFlowVersion();
    await repo.createFlowVersion(flow);
    const session = buildSession(flow.id, "completed");
    await repo.createSession(session);
    await repo.addMessage({
      id: randomUUID(),
      session_id: session.id,
      role: "user",
      message_text: "最近主要问题是优先级混乱",
      created_at: new Date().toISOString(),
    });

    await expect(tryAutoGenerateInsightOnCompletion({
      sessionId: session.id,
      language: "zh",
    })).resolves.toBeUndefined();

    const latestSession = await repo.getSession(session.id);
    expect(latestSession?.state_jsonb.ai_thinking_meta?.latest_trigger).toBe("auto_on_completed");
    const latestError = String(latestSession?.state_jsonb.ai_thinking_meta?.latest_error ?? "");
    expect(latestError.length).toBeGreaterThan(0);
    expect(
      latestError.includes("prompt")
      || latestError.includes("Model calls disabled"),
    ).toBe(true);

    const history = await repo.listInsightRuns(session.id, 10);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.trigger_source).toBe("auto_on_completed");
  });
});
