import { NextRequest, NextResponse } from "next/server";
import { getInterviewRepository } from "@/server/repo";

function readToken(request: NextRequest) {
  const direct = request.headers.get("x-admin-token");
  if (direct) return direct;
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const expected = process.env.INTERVIEW_TRACE_ADMIN_KEY;
  if (!expected) {
    return NextResponse.json(
      {
        error: "Trace endpoint disabled. Set INTERVIEW_TRACE_ADMIN_KEY to enable admin trace access.",
      },
      { status: 403 },
    );
  }

  const token = readToken(request);
  if (!token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const repo = getInterviewRepository();
  const trace = await repo.getSessionTrace(params.id, 400);
  return NextResponse.json(trace);
}
