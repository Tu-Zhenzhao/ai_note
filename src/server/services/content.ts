import { randomUUID } from "crypto";
import { OutputFormat } from "@/lib/types";
import { generateModelText } from "@/server/model/adapters";
import { contentSystemPrompt, contentUserPrompt } from "@/server/prompts/content";

function fallbackContent(format: OutputFormat, brief: Record<string, unknown>) {
  const topic = String(brief.topic ?? "Topic");
  if (format === "linkedin_carousel") {
    return {
      title: topic,
      slides: [
        "Slide 1: Hook",
        "Slide 2: Problem",
        "Slide 3: Why this matters",
        "Slide 4: Strategy",
        "Slide 5: Proof",
        "Slide 6: CTA",
      ],
    };
  }

  if (format === "linkedin_long_image") {
    return {
      title: topic,
      blocks: ["Hook", "Context", "Insight", "Proof", "Takeaway", "CTA"],
    };
  }

  if (format === "linkedin_short_video_script") {
    return {
      title: topic,
      script: ["Opening hook", "Problem", "Insight", "Proof", "CTA"],
    };
  }

  return {
    title: topic,
    post: "Hook\n\nInsight\n\nProof\n\nCTA",
  };
}

export async function generateContent(params: {
  sessionId: string;
  briefId: string;
  outputFormat: OutputFormat;
  brief: Record<string, unknown>;
}) {
  try {
    const text = await generateModelText({
      system: contentSystemPrompt(),
      prompt: contentUserPrompt(params.outputFormat, JSON.stringify(params.brief)),
    });

    return {
      id: randomUUID(),
      session_id: params.sessionId,
      brief_id: params.briefId,
      format: params.outputFormat,
      content_jsonb: {
        raw_text: text,
      },
      created_at: new Date().toISOString(),
    };
  } catch {
    return {
      id: randomUUID(),
      session_id: params.sessionId,
      brief_id: params.briefId,
      format: params.outputFormat,
      content_jsonb: fallbackContent(params.outputFormat, params.brief),
      created_at: new Date().toISOString(),
    };
  }
}
