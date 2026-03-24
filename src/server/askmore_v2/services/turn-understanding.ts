import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2TurnUnderstandingPrompt } from "@/server/askmore_v2/prompts";
import {
  AskmoreV2Language,
  AskmoreV2TurnAgentOutput,
} from "@/server/askmore_v2/types";

const schema = z.object({
  understanding_feedback: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  answer_status: z.enum(["complete", "partial", "off_topic"]),
  missing_points: z.array(z.string().min(1)).default([]),
  suggested_next_action: z.enum([
    "advance_to_next_question",
    "ask_clarification",
    "show_summary",
    "end_interview",
  ]),
  next_question: z.string().min(1),
  example_answers: z.array(z.string().min(1)).max(4).default([]),
  summary_patch: z.record(z.string(), z.unknown()).default({}),
  readiness: z.object({
    readiness_score: z.number().min(0).max(1),
    can_generate_summary: z.boolean(),
    should_end_early: z.boolean(),
    reason: z.string().min(1),
  }),
});

function fallbackOutput(params: {
  language: AskmoreV2Language;
  userMessage: string;
  activeQuestion: string;
  allowFollowUp: boolean;
}): AskmoreV2TurnAgentOutput {
  const text = params.userMessage.trim();
  const length = text.length;
  const isShort = length < 18;
  const isQuestion = /[?？]$/.test(text);
  const answerStatus: AskmoreV2TurnAgentOutput["answer_status"] = isQuestion
    ? "off_topic"
    : isShort
      ? "partial"
      : "complete";
  const suggestedNextAction: AskmoreV2TurnAgentOutput["suggested_next_action"] =
    answerStatus === "complete"
      ? "advance_to_next_question"
      : params.allowFollowUp
        ? "ask_clarification"
        : "advance_to_next_question";

  if (params.language === "zh") {
    return {
      understanding_feedback:
        answerStatus === "complete"
          ? `我理解你的核心意思是：${text.slice(0, 80)}。`
          : "我理解到了一部分信息，但还不够完整。",
      confidence: answerStatus === "complete" ? "medium" : "low",
      answer_status: answerStatus,
      missing_points:
        answerStatus === "complete"
          ? []
          : ["还缺少更具体的对象或场景说明"],
      suggested_next_action: suggestedNextAction,
      next_question: params.activeQuestion,
      example_answers: [
        "我们主要服务的是……",
        "当前阶段最重要的是……",
        "一个典型场景是……",
      ],
      summary_patch: answerStatus === "complete"
        ? {
            latest_user_signal: text.slice(0, 120),
          }
        : {},
      readiness: {
        readiness_score: answerStatus === "complete" ? 0.62 : 0.4,
        can_generate_summary: true,
        should_end_early: false,
        reason: answerStatus === "complete" ? "已获取一条可用信息。" : "信息仍偏少。",
      },
    };
  }

  return {
    understanding_feedback:
      answerStatus === "complete"
        ? `I understand your main point as: ${text.slice(0, 80)}.`
        : "I captured part of your answer, but key details are still missing.",
    confidence: answerStatus === "complete" ? "medium" : "low",
    answer_status: answerStatus,
    missing_points:
      answerStatus === "complete"
        ? []
        : ["A more concrete audience or scenario is still missing"],
    suggested_next_action: suggestedNextAction,
    next_question: params.activeQuestion,
    example_answers: [
      "Our main users are...",
      "At this stage, the key focus is...",
      "A typical use case is...",
    ],
    summary_patch: answerStatus === "complete"
      ? {
          latest_user_signal: text.slice(0, 120),
        }
      : {},
    readiness: {
      readiness_score: answerStatus === "complete" ? 0.62 : 0.4,
      can_generate_summary: true,
      should_end_early: false,
      reason: answerStatus === "complete" ? "At least one usable signal was captured." : "More detail is still required.",
    },
  };
}

export async function understandTurnAndDecide(params: {
  language: AskmoreV2Language;
  activeQuestion: string;
  activeSubQuestion: string;
  userMessage: string;
  turnCount: number;
  allowFollowUp: boolean;
  structuredKnowledge: Record<string, unknown>;
}): Promise<AskmoreV2TurnAgentOutput> {
  try {
    const result = await generateModelObject({
      system: askmoreV2TurnUnderstandingPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Turn count: ${params.turnCount}`,
        `Allow follow up: ${params.allowFollowUp ? "yes" : "no"}`,
        `Active question: ${params.activeQuestion}`,
        `Active sub question: ${params.activeSubQuestion}`,
        `User message: ${params.userMessage}`,
        `Structured knowledge JSON: ${JSON.stringify(params.structuredKnowledge)}`,
      ].join("\n"),
      schema,
    });

    if (!params.allowFollowUp && result.suggested_next_action === "ask_clarification") {
      return {
        ...result,
        suggested_next_action: "advance_to_next_question",
      };
    }

    return result;
  } catch {
    return fallbackOutput({
      language: params.language,
      userMessage: params.userMessage,
      activeQuestion: params.activeQuestion,
      allowFollowUp: params.allowFollowUp,
    });
  }
}
