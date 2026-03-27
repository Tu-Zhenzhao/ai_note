import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateModelObjectMock, ensureAskmoreV2PostgresReadyMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
  ensureAskmoreV2PostgresReadyMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
  getLastModelRoute: () => ({ modelUsed: "gpt-5", provider: "openai" }),
}));

vi.mock("@/server/askmore_v2/db-preflight", () => ({
  ensureAskmoreV2PostgresReady: ensureAskmoreV2PostgresReadyMock,
}));

import { createAiThinking } from "@/server/askmore_v2/insight/service";
import { getAskmoreV2Repository, resetAskmoreV2RepositoryForTests } from "@/server/askmore_v2/repo";
import { resetAskmoreV2MemoryStore } from "@/server/askmore_v2/repo/memory-repo";
import { AskmoreV2FlowVersion, AskmoreV2Session } from "@/server/askmore_v2/types";

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
      scenario: "心理咨询 intake",
      target_output_type: "咨询建议",
      language: "zh",
      cards_snapshot: [
        {
          question_id: "q1",
          original_question: "最近状态怎么样？",
          analysis: {
            evaluation: {
              is_too_broad: false,
              is_too_abstract: false,
              difficulty: "medium",
            },
            reason: "ok",
          },
          ai_candidate: {
            entry_question: "最近状态怎么样？",
            sub_questions: ["什么情境会更明显？"],
            example_answer_styles: ["一句话版"],
            recommended_strategy: "direct_then_clarify",
          },
          selection: { mode: "use_ai_refined" },
          final_payload: {
            entry_question: "最近状态怎么样？",
            sub_questions: ["什么情境会更明显？"],
            example_answer_styles: ["一句话版"],
            recommended_strategy: "direct_then_clarify",
            source_mode: "use_ai_refined",
          },
        },
      ],
      final_flow_questions: [
        {
          question_id: "q1",
          original_question: "最近状态怎么样？",
          entry_question: "最近状态怎么样？",
          sub_questions: ["什么情境会更明显？"],
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

function buildCompletedSession(flowVersionId: string): AskmoreV2Session {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    flow_version_id: flowVersionId,
    status: "completed",
    turn_count: 4,
    state_version: 1,
    state_jsonb: {
      session: {
        current_question_id: null,
        current_sub_question_index: 0,
        summary_generated: true,
        finalized: true,
        pending_end_confirmation: false,
        last_missing_points: [],
        last_understanding_feedback: "已收到信息",
      },
      recent_user_turns: ["看到同龄人动态会焦虑，晚上会哭。"],
      recent_dimension_prompts: [],
      nodes: {},
      node_runtime: {},
      question_progress: {
        q1: {
          question_id: "q1",
          status: "completed",
          times_asked: 2,
          follow_up_count: 1,
          sub_questions_completed: [],
          sub_questions_remaining: [],
          coverage_score: 1,
        },
      },
      structured_knowledge: {
        q1__trigger: {
          value: "刷社交媒体看到同龄人动态",
          confidence: 0.9,
          confirmed: true,
          updated_at: now,
        },
      },
      latest_summary_text: "总结完成",
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
  generateModelObjectMock.mockReset();
  resetAskmoreV2RepositoryForTests();
  resetAskmoreV2MemoryStore();
});

describe("askmore v2 ai thinking smoke", () => {
  test("service + route are callable when prompts are configured", async () => {
    generateModelObjectMock
      .mockResolvedValueOnce({
        provider_intent_read: "服务方想判断状态影响程度与进入咨询切口。",
        respondent_state_read: "回答者呈现白天压抑、夜间释放。",
        expert_impression: "目前处于适合介入支持的阶段。",
        observed_facts: ["夜里会偷偷哭", "社交媒体触发焦虑"],
        signals: ["社会比较压力", "自责"],
        claims: ["情绪已开始影响日常稳定感"],
        unsupported_speculations: [],
        underlying_drivers_evidence: [
          {
            hypothesis: "比较触发的价值感波动循环",
            support: ["社交媒体触发焦虑"],
            confidence: "medium",
          },
        ],
        boundary_notes: ["不做诊断结论。"],
      })
      .mockResolvedValueOnce({
        draft1_professional_read: "我看到你提到夜里会哭，这常见于白天持续压抑后的情绪回流。",
        draft1_attention_points: "有没有可能你白天都在撑，所以夜间更容易崩开。",
        draft1_practical_guidance: "建议先记录触发-想法-情绪链条，再进入咨询。",
        observation_anchors: ["夜里会偷偷哭", "社交媒体触发焦虑"],
        open_questions_or_hypotheses: ["有没有可能你白天在硬撑"],
        tone_risks_to_avoid_in_draft2: ["避免结论先行"],
      })
      .mockResolvedValueOnce({
        professional_read: "我看到你反复提到同辈比较，这让我在想，痛点可能不只是焦虑，而是你开始拿外在进度衡量自己。有没有可能你白天一直在硬撑？",
        what_i_would_pay_attention_to: "我会特别留意你白天如何维持、夜间为何崩开。你有没有发现，触发点是不是几乎都和比较情境有关？",
        practical_guidance: "我会先建议你记录一周的触发链条，再带着记录进入咨询，这样更贴合你现在‘能运转但很耗竭’的状态。",
        boundary_notes: ["本结果不替代诊断。"],
      })
      .mockResolvedValueOnce({
        provider_intent_read: "服务方想判断状态影响程度与进入咨询切口。",
        respondent_state_read: "回答者呈现白天压抑、夜间释放。",
        expert_impression: "目前处于适合介入支持的阶段。",
        observed_facts: ["夜里会偷偷哭", "社交媒体触发焦虑"],
        signals: ["社会比较压力", "自责"],
        claims: ["情绪已开始影响日常稳定感"],
        unsupported_speculations: [],
        underlying_drivers_evidence: [
          {
            hypothesis: "比较触发的价值感波动循环",
            support: ["社交媒体触发焦虑"],
            confidence: "medium",
          },
        ],
        boundary_notes: ["不做诊断结论。"],
      })
      .mockResolvedValueOnce({
        draft1_professional_read: "我看到你提到夜里会哭，这常见于白天持续压抑后的情绪回流。",
        draft1_attention_points: "有没有可能你白天都在撑，所以夜间更容易崩开。",
        draft1_practical_guidance: "建议先记录触发-想法-情绪链条，再进入咨询。",
        observation_anchors: ["夜里会偷偷哭", "社交媒体触发焦虑"],
        open_questions_or_hypotheses: ["有没有可能你白天在硬撑"],
        tone_risks_to_avoid_in_draft2: ["避免结论先行"],
      })
      .mockResolvedValueOnce({
        professional_read: "我看到你反复提到同辈比较，这让我在想，痛点可能不只是焦虑，而是你开始拿外在进度衡量自己。有没有可能你白天一直在硬撑？",
        what_i_would_pay_attention_to: "我会特别留意你白天如何维持、夜间为何崩开。你有没有发现，触发点是不是几乎都和比较情境有关？",
        practical_guidance: "我会先建议你记录一周的触发链条，再带着记录进入咨询，这样更贴合你现在‘能运转但很耗竭’的状态。",
        boundary_notes: ["本结果不替代诊断。"],
      });

    const repo = getAskmoreV2Repository();
    const flow = buildFlowVersion();
    await repo.createFlowVersion(flow);
    const session = buildCompletedSession(flow.id);
    await repo.createSession(session);
    await repo.addMessage({
      id: randomUUID(),
      session_id: session.id,
      role: "user",
      message_text: "看到同龄人动态会焦虑，晚上会哭。",
      created_at: new Date().toISOString(),
    });

    const serviceResult = await createAiThinking({
      sessionId: session.id,
      trigger: "manual",
      forceRegenerate: true,
      language: "zh",
    });
    expect(serviceResult.ai_thinking_result.version).toBe("ai_thinking.v2");
    expect(serviceResult.ai_thinking_result.professional_read.length).toBeGreaterThan(0);

    const firstCallArgs = generateModelObjectMock.mock.calls[0]?.[0] as { system: string; prompt: string };
    expect(firstCallArgs.system.trim().length).toBeGreaterThan(0);
    expect(firstCallArgs.prompt.includes("Stage A")).toBe(true);

    const { POST } = await import("../app/api/askmore_v2/interview/insight/route");
    const response = await POST(
      new NextRequest("http://localhost/api/askmore_v2/interview/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.id,
          language: "zh",
          force_regenerate: true,
        }),
      }),
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ai_thinking_result?.version).toBe("ai_thinking.v2");
    expect(typeof data.run_meta?.run_id).toBe("string");
  });
});
