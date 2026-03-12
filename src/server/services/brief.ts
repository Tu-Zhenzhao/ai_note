import { randomUUID } from "crypto";
import { InterviewState, OutputFormat } from "@/lib/types";
import { generateModelObject } from "@/server/model/adapters";
import { briefSystemPrompt, briefUserPrompt } from "@/server/prompts/brief";
import { z } from "zod";

const briefSchema = z.object({
  topic: z.string(),
  content_goal: z.string(),
  format: z.string(),
  target_audience: z.string(),
  angle: z.string(),
  structure: z.array(z.string()),
  proof_points: z.array(z.string()),
  tone_guidance: z.array(z.string()),
  constraints: z.array(z.string()),
});

export async function generateBrief(params: {
  sessionId: string;
  state: InterviewState;
  chosenDirection: string;
  chosenFormat: OutputFormat;
  strategicNotes?: string[];
}) {
  const payload = JSON.stringify(params.state);
  const fallbackBrief = {
    topic: params.chosenDirection,
    content_goal: "Deliver a credible first LinkedIn content asset aligned to strategy",
    format: params.chosenFormat,
    target_audience: "Primary audience from interview",
    angle: "Practical, specific, proof-backed",
    structure: ["Hook", "Problem", "Insight", "Proof", "Takeaway", "CTA"],
    proof_points: [],
    tone_guidance: ["analytical", "insight-driven", "practical"],
    constraints: [],
  };

  try {
    const brief = await generateModelObject({
      system: briefSystemPrompt(),
      prompt: briefUserPrompt(
        payload,
        params.chosenDirection,
        params.chosenFormat,
        params.strategicNotes ?? [],
      ),
      schema: briefSchema,
    });

    return {
      id: randomUUID(),
      session_id: params.sessionId,
      format: params.chosenFormat,
      brief_jsonb: brief,
      approved: true,
      created_at: new Date().toISOString(),
    };
  } catch {
    return {
      id: randomUUID(),
      session_id: params.sessionId,
      format: params.chosenFormat,
      brief_jsonb: fallbackBrief,
      approved: true,
      created_at: new Date().toISOString(),
    };
  }
}
