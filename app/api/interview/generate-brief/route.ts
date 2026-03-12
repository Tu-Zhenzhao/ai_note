import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_GENERATION_FORMAT } from "@/lib/state";
import { OutputFormat } from "@/lib/types";
import { getInterviewRepository } from "@/server/repo";
import { evaluateCompletion } from "@/server/rules/completion";
import { generateBrief } from "@/server/services/brief";

const bodySchema = z.object({
  session_id: z.string().min(1),
  chosen_direction: z.string().min(1),
  chosen_format: z
    .enum(["linkedin_carousel", "linkedin_long_image", "linkedin_short_video_script", "linkedin_post_copy"])
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    const repo = getInterviewRepository();
    const stateRecord = await repo.getState(payload.session_id);
    if (!stateRecord) {
      return NextResponse.json({ error: "Session state not found" }, { status: 404 });
    }

    const completionState = evaluateCompletion(stateRecord.state_jsonb);
    if (!completionState.generation_permission_flag) {
      return NextResponse.json(
        {
          error: "Generation not allowed yet. Preview approval and completion gates are required.",
          completion_state: completionState,
        },
        { status: 400 },
      );
    }

    const format = (payload.chosen_format ?? DEFAULT_GENERATION_FORMAT) as OutputFormat;
    const strategicNotes = (await repo.listChatBookEntries(payload.session_id, 20))
      .filter((entry) => entry.entry_type === "strategy_note" || entry.entry_type === "direct_user_fact")
      .map((entry) => entry.text)
      .slice(0, 8);

    const brief = await generateBrief({
      sessionId: payload.session_id,
      state: stateRecord.state_jsonb,
      chosenDirection: payload.chosen_direction,
      chosenFormat: format,
      strategicNotes,
    });

    await repo.addBrief(brief);

    return NextResponse.json({
      content_brief: brief,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
