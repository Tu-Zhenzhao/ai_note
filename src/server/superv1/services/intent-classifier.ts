import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { SuperV1IntentResult, SuperV1Turn } from "@/server/superv1/types";
import { superV1IntentSystemPrompt } from "@/server/prompts/superv1";

const schema = z.object({
  intent: z.enum(["answer_question", "ask_for_help", "other_discussion"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

function looksLikeHelp(message: string): boolean {
  const text = message.toLowerCase();
  return [
    "not sure",
    "don't know",
    "help me",
    "can you help",
    "suggest",
    "give me options",
    "不确定",
    "不知道",
    "给我建议",
    "帮我",
  ].some((token) => text.includes(token));
}

function looksLikeDiscussion(message: string): boolean {
  const text = message.trim().toLowerCase();
  return /[?？]$/.test(text) || /(what do you mean|can you explain|什么意思|解释一下)/i.test(text);
}

function deterministicFallback(message: string): SuperV1IntentResult {
  if (looksLikeHelp(message)) {
    return {
      intent: "ask_for_help",
      confidence: 0.9,
      reason: "Detected explicit request for answer help.",
    };
  }
  if (looksLikeDiscussion(message)) {
    return {
      intent: "other_discussion",
      confidence: 0.7,
      reason: "Detected clarification/discussion-style turn.",
    };
  }
  return {
    intent: "answer_question",
    confidence: 0.7,
    reason: "Defaulting to answer flow to preserve deterministic progress.",
  };
}

function formatRecentTurns(turns: SuperV1Turn[]): string {
  return turns
    .map((turn) => `${turn.role}: ${turn.message_text.replace(/\s+/g, " ").trim()}`)
    .join("\n");
}

export async function classifyIntent(params: {
  userMessage: string;
  currentSectionId: string;
  recentTurns: SuperV1Turn[];
  previousAssistantQuestion: string;
}): Promise<SuperV1IntentResult> {
  try {
    return await generateModelObject({
      system: superV1IntentSystemPrompt(),
      prompt: [
        `Current section: ${params.currentSectionId}`,
        `Previous assistant question: ${params.previousAssistantQuestion || "none"}`,
        `Latest user message: ${params.userMessage}`,
        `Recent turns:\n${formatRecentTurns(params.recentTurns.slice(-2)) || "none"}`,
      ].join("\n"),
      schema,
    });
  } catch {
    return deterministicFallback(params.userMessage);
  }
}
