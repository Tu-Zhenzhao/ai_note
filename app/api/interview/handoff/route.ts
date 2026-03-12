import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInterviewRepository } from "@/server/repo";
import { createHandoffSummary } from "@/server/services/handoff";

const bodySchema = z.object({
  session_id: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    const repo = getInterviewRepository();
    const stateRecord = await repo.getState(payload.session_id);

    if (!stateRecord) {
      return NextResponse.json({ error: "Session state not found" }, { status: 404 });
    }

    const handoff = await createHandoffSummary(payload.session_id, stateRecord.state_jsonb);
    await repo.addHandoffSummary(handoff);

    return NextResponse.json({
      handoff_summary: handoff,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
