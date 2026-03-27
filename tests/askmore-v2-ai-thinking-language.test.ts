import { describe, expect, test } from "vitest";
import {
  composeAiThinkingStageBPrompt,
  resolveAiThinkingOutputLanguage,
} from "@/server/askmore_v2/insight/prompt-composer";

describe("askmore v2 ai thinking language routing", () => {
  test("uses Chinese when context is dominantly Chinese", () => {
    const context = {
      session_id: "sess_zh",
      domain: "mental_health" as const,
      subdomain: "intake",
      conversation_history: [
        {
          role: "user" as const,
          content: "我最近总是焦虑，晚上会失眠，还会偷偷哭。",
          created_at: new Date().toISOString(),
        },
      ],
      question_sheet: [],
      structured_answers: {
        q1__trigger: "刷社交媒体看到同龄人动态时会明显焦虑",
      },
      intake_summary: {
        completion_ratio: 1,
        completed_questions: 1,
        total_questions: 1,
        last_missing_points: [],
        latest_summary_text: "已完成",
      },
      user_goal: "希望知道自己到底怎么了",
      metadata: {
        language: "en" as const,
        scenario: "心理咨询",
        target_output_type: "咨询建议",
        turn_count: 5,
        session_status: "completed",
      },
    };

    const language = resolveAiThinkingOutputLanguage(context);
    expect(language).toBe("zh");
  });

  test("injects explicit English language requirement when context is English", () => {
    const context = {
      session_id: "sess_en",
      domain: "business" as const,
      subdomain: "general_strategy",
      conversation_history: [
        {
          role: "user" as const,
          content: "Our biggest issue is retention after trial conversion and weak onboarding activation.",
          created_at: new Date().toISOString(),
        },
      ],
      question_sheet: [],
      structured_answers: {
        q1__goal: "Improve retention in the first 30 days",
      },
      intake_summary: {
        completion_ratio: 1,
        completed_questions: 1,
        total_questions: 1,
        last_missing_points: [],
        latest_summary_text: "Completed",
      },
      user_goal: "Find the right strategic focus",
      metadata: {
        language: "zh" as const,
        scenario: "business consulting",
        target_output_type: "strategy advice",
        turn_count: 4,
        session_status: "completed",
      },
    };

    const composed = composeAiThinkingStageBPrompt({
      context,
      packTrace: {
        core_pack: "core.ai_thinking.v2",
        domain_pack: "business.general.v2",
        subdomain_packs: [],
        style_pack: "style.direct_advisor.v1",
        safety_pack: "safety.standard.v1",
      },
      stageAResult: {
        provider_intent_read: "Provider wants to prioritize growth diagnosis.",
        respondent_state_read: "Responder is analytical but overloaded.",
        expert_impression: "The case needs prioritization and user-value focus.",
        observed_facts: ["trial conversion weak"],
        signals: ["activation gap"],
        claims: ["retention bottleneck"],
        unsupported_speculations: [],
        underlying_drivers_evidence: [
          {
            hypothesis: "onboarding mismatch",
            support: ["activation weak"],
            confidence: "medium",
          },
        ],
        boundary_notes: [],
      },
    });

    expect(composed.prompt).toContain("Write all visible output fields in English.");
    expect(composed.promptComposition).toContain("output_language:en");
    expect(composed.promptComposition).toContain("stage_b_write");
    expect(composed.promptComposition).toContain("context_language_signal");
    expect(composed.prompt).toContain("\"target_output_language\":\"en\"");
  });
});
