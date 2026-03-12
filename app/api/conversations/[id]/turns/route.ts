import { NextResponse } from "next/server";
import { getSuperV1ConversationState, getSuperV1ConversationTurns } from "@/server/superv1/services/conversation-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const state = await getSuperV1ConversationState(params.id);
  if (!state) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  const turns = await getSuperV1ConversationTurns(params.id);
  return NextResponse.json({ turns });
}
