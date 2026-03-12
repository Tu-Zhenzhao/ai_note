import { NextRequest, NextResponse } from "next/server";
import { getSuperV1ConversationAudit } from "@/server/superv1/services/conversation-service";

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
      { error: "Audit endpoint disabled. Set INTERVIEW_TRACE_ADMIN_KEY to enable admin access." },
      { status: 403 },
    );
  }
  const token = readToken(request);
  if (!token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const audit = await getSuperV1ConversationAudit(params.id);
  if (!audit) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  return NextResponse.json(audit);
}

