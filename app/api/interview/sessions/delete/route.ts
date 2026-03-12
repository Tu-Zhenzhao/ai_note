import { NextRequest, NextResponse } from "next/server";
import { getInterviewRepository } from "@/server/repo";
import { z } from "zod";

const bodySchema = z.object({
  session_id: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const payload = bodySchema.parse(await request.json());
    const repo = getInterviewRepository();

    const existing = await repo.getSession(payload.session_id);
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await repo.deleteSession(payload.session_id);
    return NextResponse.json({ deleted: true, session_id: payload.session_id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
