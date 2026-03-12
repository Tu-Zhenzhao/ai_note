import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OutputFormat } from "@/lib/types";
import { getInterviewRepository } from "@/server/repo";
import { generateContent } from "@/server/services/content";

const bodySchema = z.object({
  session_id: z.string().min(1),
  brief_id: z.string().min(1),
  output_format: z.enum([
    "linkedin_carousel",
    "linkedin_long_image",
    "linkedin_short_video_script",
    "linkedin_post_copy",
  ]),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    const repo = getInterviewRepository();
    const brief = await repo.getBrief(payload.brief_id);

    if (!brief || brief.session_id !== payload.session_id) {
      return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    }

    const generated = await generateContent({
      sessionId: payload.session_id,
      briefId: payload.brief_id,
      outputFormat: payload.output_format as OutputFormat,
      brief: brief.brief_jsonb,
    });

    await repo.addGeneratedContent(generated);

    return NextResponse.json({
      generated_content: generated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
