import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { SuperV1ExtractionOutput, SuperV1TemplateQuestion, SuperV1Turn } from "@/server/superv1/types";

const extractionSchema = z.object({
  filled_items: z.array(
    z.object({
      question_id: z.string().min(1),
      value: z.any(),
      confidence: z.number().min(0).max(1),
      evidence: z.string().min(1),
    }),
  ).default([]),
  ambiguous_items: z.array(
    z.object({
      question_id: z.string().min(1),
      reason: z.string().min(1),
    }),
  ).default([]),
  possible_items: z.array(
    z.object({
      question_id: z.string().min(1),
      value: z.any(),
      reason: z.string().min(1),
    }),
  ).default([]),
});

function formatRecentTurns(turns: SuperV1Turn[]): string {
  return turns
    .map((turn) => `${turn.role}: ${turn.message_text.replace(/\s+/g, " ").trim()}`)
    .join("\n");
}

function fallbackExtraction(params: {
  userMessage: string;
  openQuestions: SuperV1TemplateQuestion[];
}): SuperV1ExtractionOutput {
  const firstQuestion = params.openQuestions[0];
  const text = params.userMessage.trim();
  if (!firstQuestion || text.length < 6) {
    return {
      filled_items: [],
      ambiguous_items: [],
      possible_items: [],
    };
  }
  return {
    filled_items: [
      {
        question_id: firstQuestion.question_id,
        value: text,
        confidence: 0.76,
        evidence: text.slice(0, 220),
      },
    ],
    ambiguous_items: [],
    possible_items: [],
  };
}

export async function extractStructuredFacts(params: {
  userMessage: string;
  activeSectionId: string;
  openQuestions: SuperV1TemplateQuestion[];
  recentTurns: SuperV1Turn[];
}): Promise<SuperV1ExtractionOutput> {
  const openQuestionSpec = params.openQuestions.map((q) => ({
    question_id: q.question_id,
    question_text: q.question_text,
    question_description: q.question_description,
    field_type: q.field_type,
  }));

  try {
    return await generateModelObject({
      system: [
        "You extract checklist answers from a user turn.",
        "Return strict JSON with filled_items, ambiguous_items, possible_items.",
        "Only fill question_id values from the provided open questions list.",
        "Do not invent facts or strengthen vague claims.",
        "Attach evidence text for each filled item.",
      ].join(" "),
      prompt: [
        `Active section: ${params.activeSectionId}`,
        `Latest user message: ${params.userMessage}`,
        `Open questions:\n${JSON.stringify(openQuestionSpec)}`,
        `Recent turns:\n${formatRecentTurns(params.recentTurns.slice(-4)) || "none"}`,
      ].join("\n"),
      schema: extractionSchema,
    });
  } catch {
    return fallbackExtraction({
      userMessage: params.userMessage,
      openQuestions: params.openQuestions,
    });
  }
}

