import { describe, expect, test } from "vitest";
import {
  evaluateAiThinkingDraft2Style,
  normalizeAiThinkingResult,
} from "@/server/askmore_v2/insight/normalizer";

describe("askmore v2 ai thinking normalizer", () => {
  test("fills missing fields and computes quality flags", () => {
    const result = normalizeAiThinkingResult({
      raw: {
        professional_read: "这不是简单焦虑，而是比较触发后的自我价值受损。",
      },
      stageA: {
        provider_intent_read: "服务方在判断严重程度与切入点。",
        respondent_state_read: "白天克制，夜间情绪溢出。",
        expert_impression: "适合尽快进入咨询而非继续拖延。",
        observed_facts: ["夜里会哭", "刷社交媒体触发波动"],
        signals: ["社会比较", "自责"],
        claims: ["当前处于可干预窗口期"],
        unsupported_speculations: [],
        underlying_drivers_evidence: [
          {
            hypothesis: "比较-自责循环",
            support: ["刷社交媒体触发波动"],
            confidence: "medium",
          },
        ],
        boundary_notes: [],
      },
      domain: "mental_health",
      packTrace: {
        core_pack: "core.ai_thinking.v2",
        domain_pack: "mental_health.intake.v2",
        subdomain_packs: [],
        style_pack: "style.warm_clinical.v1",
        safety_pack: "safety.healthcare.v1",
      },
      promptComposition: ["stage_a", "stage_b"],
    });

    expect(result.version).toBe("ai_thinking.v2");
    expect(result.domain).toBe("mental_health");
    expect(result.professional_read.length).toBeGreaterThan(0);
    expect(result.stage_a_read.provider_intent_read.length).toBeGreaterThan(0);
    expect(result.pack_trace.domain_pack).toBe("mental_health.intake.v2");
    expect(result.prompt_composition).toEqual(["stage_a", "stage_b"]);
    expect(result.quality_flags.prompt_configured).toBe(true);
    expect(typeof result.quality_flags.has_observation_anchor).toBe("boolean");
    expect(typeof result.quality_flags.has_open_question_or_hypothesis).toBe("boolean");
  });

  test("flags very short/generic outputs as too_generic", () => {
    const result = normalizeAiThinkingResult({
      raw: {
        professional_read: "需要更多信息",
        what_i_would_pay_attention_to: "优先级不清晰",
        practical_guidance: "先明确优先级",
      },
      stageA: {
        provider_intent_read: "x",
        respondent_state_read: "y",
        expert_impression: "z",
        observed_facts: [],
        signals: [],
        claims: [],
        unsupported_speculations: [],
        underlying_drivers_evidence: [],
        boundary_notes: [],
      },
      domain: "business",
      packTrace: {
        core_pack: "core.ai_thinking.v2",
        domain_pack: "business.general.v2",
        subdomain_packs: [],
        style_pack: "style.direct_advisor.v1",
        safety_pack: "safety.standard.v1",
      },
    });

    expect(result.quality_flags.too_generic).toBe(true);
  });

  test("keeps unknown stage-b fields in additional_sections", () => {
    const result = normalizeAiThinkingResult({
      raw: {
        professional_read: "这是一个可介入但需尽快处理的阶段。",
        what_i_would_pay_attention_to: "我会先补看白天如何应对压力。",
        practical_guidance: "先从触发链条记录开始，再进入支持性对话。",
        provider_notes: ["更关注夜间波动", "优先稳定睡眠节律"],
        triage_hint: {
          urgency: "medium",
          reason: "已影响睡眠和情绪稳定",
        },
      },
      stageA: {
        provider_intent_read: "服务方在判断风险与进入点。",
        respondent_state_read: "夜间症状显著。",
        expert_impression: "需要及时支持。",
        observed_facts: [],
        signals: [],
        claims: [],
        unsupported_speculations: [],
        underlying_drivers_evidence: [],
        boundary_notes: [],
      },
      domain: "mental_health",
      packTrace: {
        core_pack: "core.ai_thinking.v2",
        domain_pack: "mental_health.intake.v2",
        subdomain_packs: [],
        style_pack: "style.warm_clinical.v1",
        safety_pack: "safety.healthcare.v1",
      },
    });

    expect(result.additional_sections).toBeTruthy();
    expect((result.additional_sections?.provider_notes as string[])[0]).toBe("更关注夜间波动");
    expect((result.additional_sections?.triage_hint as { urgency: string }).urgency).toBe("medium");
  });

  test("style evaluator marks conclusion-first draft for rewrite", () => {
    const style = evaluateAiThinkingDraft2Style({
      professional_read: "你目前正处于一个典型的毕业后焦虑阶段。",
      what_i_would_pay_attention_to: "建议持续观察并补充更多信息。",
      practical_guidance: "先明确优先级。",
    });

    expect(style.is_conclusion_first).toBe(true);
    expect(style.rewrite_needed).toBe(true);
  });
});
