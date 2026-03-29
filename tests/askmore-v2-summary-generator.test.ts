import { describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { AskmoreV2Session } from "@/server/askmore_v2/types";
import { generateInterviewSummary } from "@/server/askmore_v2/services/summary-generator";

function makeSession(): AskmoreV2Session {
  return {
    id: "sess_1",
    flow_version_id: "flow_1",
    status: "completed",
    turn_count: 8,
    state_version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    state_jsonb: {
      session: {
        current_question_id: null,
        current_sub_question_index: 0,
        summary_generated: true,
        finalized: true,
        pending_end_confirmation: false,
        last_missing_points: [],
        last_understanding_feedback: "我已经理解你的关键描述。",
        pending_intent: "answer_question",
        pending_commitments: [],
        active_turn_index: 8,
      },
      recent_user_turns: [],
      recent_dimension_prompts: [],
      nodes: {},
      node_runtime: {},
      question_progress: {},
      structured_knowledge: {
        q1__pet_type: {
          value: "猫咪",
          confidence: 0.9,
          confirmed: true,
          updated_at: new Date().toISOString(),
        },
        q2__symptom: {
          value: "血尿、轻微应激",
          confidence: 0.8,
          confirmed: true,
          updated_at: new Date().toISOString(),
        },
      },
      latest_summary_text: null,
      latest_structured_report: null,
      runtime_meta: {},
    },
  };
}

describe("askmore v2 summary generator", () => {
  test("final mode uses unified completion closure wording and AI Thinking guidance", async () => {
    generateModelObjectMock.mockReset();
    generateModelObjectMock.mockResolvedValue({
      summary_text: "根据你的描述，猫咪近期出现血尿与应激反应，核心线索已比较清晰。",
      structured_report_json: {
        overview: "已完成",
        confirmed_points: ["血尿", "应激"],
        open_points: [],
        next_steps: ["尿检复核"],
      },
    });

    const result = await generateInterviewSummary({
      language: "zh",
      mode: "final",
      session: makeSession(),
      messages: [
        { role: "user", message_text: "我的猫咪最近血尿" },
        { role: "assistant", message_text: "我先继续确认细节" },
      ],
    });

    expect(result.summary_text).toContain("本次健康咨询已完成。");
    expect(result.summary_text).toContain("AI思考");
    expect(result.summary_text).toContain("手机端");
    expect(result.summary_text).toContain("重跑");
    expect(result.summary_text).not.toContain("本次访谈已结束。你可以先查看右侧问题进度");
  });
});
