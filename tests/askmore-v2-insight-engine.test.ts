import { describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
  getLastModelRoute: () => ({ modelUsed: "gpt-5", provider: "openai" }),
}));

vi.mock("@/server/askmore_v2/prompts", () => ({
  askmoreV2AiThinkingPromptAssets: () => ({
    system_base_prompt_v2: "SYSTEM BASE",
    stage_b_explore_v2: "STAGE B EXPLORE",
    stage_b_write_v2: "STAGE B WRITE",
    mental_health_intake_v2: "MENTAL DOMAIN",
    business_general_v2: "BUSINESS DOMAIN",
    pet_clinic_general_v2: "PET DOMAIN",
  }),
}));

import { generateAiThinking } from "@/server/askmore_v2/insight/engine";

describe("askmore v2 ai thinking engine", () => {
  test("runs stage A -> stage B draft1 -> stage B draft2 and returns normalized v2 result", async () => {
    generateModelObjectMock
      .mockResolvedValueOnce({
        provider_intent_read: "服务方在判断严重程度与进入点。",
        respondent_state_read: "白天克制，夜间情绪释放。",
        expert_impression: "目前处于适合及时支持的窗口期。",
        observed_facts: ["夜里会哭", "刷社交媒体触发焦虑"],
        signals: ["比较压力", "自责"],
        claims: ["情绪已影响睡眠与稳定感"],
        unsupported_speculations: [],
        underlying_drivers_evidence: [
          {
            hypothesis: "社会比较触发自我价值波动",
            support: ["刷社交媒体触发焦虑"],
            confidence: "medium",
          },
        ],
        boundary_notes: ["不做确诊。"],
      })
      .mockResolvedValueOnce({
        draft1_professional_read: "我看到你提到夜里会哭，这更像在白天持续压抑后的释放。",
        draft1_attention_points: "我会猜有没有可能你白天一直在撑，所以夜间更容易崩开。",
        draft1_practical_guidance: "建议先把触发-想法-情绪链条写清楚，再进入咨询讨论。",
        observation_anchors: ["夜里会哭", "刷社交媒体触发焦虑"],
        open_questions_or_hypotheses: ["有没有可能你白天在硬撑"],
        tone_risks_to_avoid_in_draft2: ["不要结论先行"],
      })
      .mockResolvedValueOnce({
        professional_read: "我看到你反复提到同辈比较，这让我会想到你现在最痛的不只是焦虑本身，而是对自己的判断。有没有可能你白天其实一直在撑着？",
        what_i_would_pay_attention_to: "我会特别留意你白天如何维持和夜间为何崩开的链条，你有没有发现触发点几乎都和比较有关？",
        practical_guidance: "我会先建议你记录触发场景和当下自我对话，再带着这些记录进入咨询，因为这更贴合你当前‘能运转但很耗竭’的状态。",
        boundary_notes: ["本结果不替代医疗诊断。"],
      });

    const generated = await generateAiThinking({
      context: {
        session_id: "sess_1",
        domain: "mental_health",
        subdomain: "intake",
        conversation_history: [
          {
            role: "user",
            content: "我看到同龄人买房会很焦虑，晚上会偷偷哭。",
            created_at: new Date().toISOString(),
          },
        ],
        question_sheet: [],
        structured_answers: {
          q1__trigger: "刷社交媒体",
        },
        intake_summary: {
          completion_ratio: 1,
          completed_questions: 1,
          total_questions: 1,
          last_missing_points: [],
          latest_summary_text: "已完成",
        },
        user_goal: "理解自己最近的情绪问题",
        metadata: {
          language: "zh",
          scenario: "心理咨询",
          target_output_type: "咨询建议",
          turn_count: 5,
          session_status: "completed",
        },
      },
      packTrace: {
        core_pack: "core.ai_thinking.v2",
        domain_pack: "mental_health.intake.v2",
        subdomain_packs: [],
        style_pack: "style.warm_clinical.v1",
        safety_pack: "safety.healthcare.v1",
      },
    });
    const result = generated.result;

    expect(generateModelObjectMock).toHaveBeenCalledTimes(3);
    expect((generateModelObjectMock.mock.calls[0]?.[0] as { primaryModel?: string }).primaryModel).toBe("gemini-3.1-flash-lite-preview");
    expect(result.version).toBe("ai_thinking.v2");
    expect(result.professional_read.length).toBeGreaterThan(0);
    expect(result.what_i_would_pay_attention_to.length).toBeGreaterThan(0);
    expect(result.practical_guidance.length).toBeGreaterThan(0);
    expect(result.stage_a_read.provider_intent_read.length).toBeGreaterThan(0);
    expect(result.underlying_drivers_evidence.length).toBeGreaterThan(0);
    expect(generated.debug.stage_b_draft1.draft1_professional_read.length).toBeGreaterThan(0);
    expect(generated.debug.stage_b_draft2_rewrite_applied).toBe(false);
  });

  test("rewrites stage B draft2 once when style gate fails", async () => {
    generateModelObjectMock.mockReset();
    generateModelObjectMock
      .mockResolvedValueOnce({
        provider_intent_read: "服务方在判断严重程度与进入点。",
        respondent_state_read: "白天克制，夜间情绪释放。",
        expert_impression: "目前处于适合及时支持的窗口期。",
        observed_facts: ["夜里会哭"],
        signals: ["比较压力"],
        claims: ["情绪已影响睡眠"],
        unsupported_speculations: [],
        underlying_drivers_evidence: [],
        boundary_notes: [],
      })
      .mockResolvedValueOnce({
        draft1_professional_read: "我看到你提到夜里会哭，这条线索很关键。",
        draft1_attention_points: "有没有可能白天一直在撑着。",
        draft1_practical_guidance: "先梳理触发链条。",
        observation_anchors: ["夜里会哭"],
        open_questions_or_hypotheses: ["有没有可能白天一直在撑着"],
        tone_risks_to_avoid_in_draft2: ["避免结论先行"],
      })
      .mockResolvedValueOnce({
        professional_read: "你目前正处于一个典型的焦虑期。",
        what_i_would_pay_attention_to: "建议持续观察。",
        practical_guidance: "先明确优先级。",
        boundary_notes: [],
      })
      .mockResolvedValueOnce({
        professional_read: "我看到你提到夜里会哭，这让我会特别留意你白天是否一直在硬撑。有没有可能你真正难受的是对自己的苛责？",
        what_i_would_pay_attention_to: "我会好奇你有没有发现，触发点是否总在比较情境里，这能帮助我们看见更深层的压力模式。",
        practical_guidance: "我会先建议你记录一周的触发链条，再进入支持性对话，因为这比空泛地‘积极一点’更贴合你当前状态。",
        boundary_notes: [],
      });

    const generated = await generateAiThinking({
      context: {
        session_id: "sess_2",
        domain: "mental_health",
        subdomain: "intake",
        conversation_history: [
          {
            role: "user",
            content: "我晚上会偷偷哭。",
            created_at: new Date().toISOString(),
          },
        ],
        question_sheet: [],
        structured_answers: {},
        intake_summary: {
          completion_ratio: 1,
          completed_questions: 1,
          total_questions: 1,
          last_missing_points: [],
          latest_summary_text: "已完成",
        },
        user_goal: "想看清自己状态",
        metadata: {
          language: "zh",
          scenario: "心理咨询",
          target_output_type: "咨询建议",
          turn_count: 3,
          session_status: "completed",
        },
      },
      packTrace: {
        core_pack: "core.ai_thinking.v2",
        domain_pack: "mental_health.intake.v2",
        subdomain_packs: [],
        style_pack: "style.warm_clinical.v1",
        safety_pack: "safety.healthcare.v1",
      },
    });

    expect(generateModelObjectMock).toHaveBeenCalledTimes(4);
    expect(generated.debug.stage_b_draft2_rewrite_applied).toBe(true);
    expect(generated.debug.stage_b_draft2_rewrite_reasons).toContain("conclusion_first");
    expect(generated.result.prompt_composition?.includes("stage_b_draft2_retry")).toBe(true);
  });

  test("retries once on transient abort error", async () => {
    generateModelObjectMock.mockReset();
    generateModelObjectMock
      .mockRejectedValueOnce(new Error("This operation was aborted"))
      .mockResolvedValueOnce({
        provider_intent_read: "服务方在判断严重程度与进入点。",
        respondent_state_read: "白天克制，夜间情绪释放。",
        expert_impression: "适合尽快支持。",
        observed_facts: ["夜里会哭"],
        signals: ["比较压力"],
        claims: ["影响睡眠稳定"],
        unsupported_speculations: [],
        underlying_drivers_evidence: [],
        boundary_notes: [],
      })
      .mockResolvedValueOnce({
        draft1_professional_read: "我看到你提到夜里会哭，这条线索很关键。",
        draft1_attention_points: "我会猜有没有可能你白天在硬撑。",
        draft1_practical_guidance: "建议先梳理触发链条。",
        observation_anchors: ["夜里会哭"],
        open_questions_or_hypotheses: ["有没有可能白天在硬撑"],
        tone_risks_to_avoid_in_draft2: [],
      })
      .mockResolvedValueOnce({
        professional_read: "我看到你提到夜里会哭，这让我会想到你白天可能一直在压着自己。有没有可能你并不是扛不住，而是扛太久了？",
        what_i_would_pay_attention_to: "我会特别留意触发点是否总跟比较有关，你有没有发现这个模式已经反复出现？",
        practical_guidance: "我会先建议记录触发-想法-情绪链条，再进入支持性对话，因为这更贴合你当前状态。",
        boundary_notes: [],
      });

    const generated = await generateAiThinking({
      context: {
        session_id: "sess_3",
        domain: "mental_health",
        subdomain: "intake",
        conversation_history: [
          {
            role: "user",
            content: "我晚上会偷偷哭。",
            created_at: new Date().toISOString(),
          },
        ],
        question_sheet: [],
        structured_answers: {},
        intake_summary: {
          completion_ratio: 1,
          completed_questions: 1,
          total_questions: 1,
          last_missing_points: [],
          latest_summary_text: "已完成",
        },
        user_goal: "看清自己现在怎么了",
        metadata: {
          language: "zh",
          scenario: "心理咨询",
          target_output_type: "咨询建议",
          turn_count: 3,
          session_status: "completed",
        },
      },
      packTrace: {
        core_pack: "core.ai_thinking.v2",
        domain_pack: "mental_health.intake.v2",
        subdomain_packs: [],
        style_pack: "style.warm_clinical.v1",
        safety_pack: "safety.healthcare.v1",
      },
    });

    expect(generateModelObjectMock).toHaveBeenCalledTimes(4);
    expect((generateModelObjectMock.mock.calls[0]?.[0] as { primaryModel?: string }).primaryModel).toBe("gemini-3.1-flash-lite-preview");
    expect((generateModelObjectMock.mock.calls[0]?.[0] as { timeoutMs?: number }).timeoutMs).toBeGreaterThan(12000);
    expect(generated.result.professional_read.length).toBeGreaterThan(0);
  });
});
