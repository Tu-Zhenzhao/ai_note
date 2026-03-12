import { NextResponse } from "next/server";
import { getInterviewRepository } from "@/server/repo";

export async function GET() {
  try {
    const repo = getInterviewRepository();
    const sessions = await repo.listSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
