import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/server/auth/api-auth";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { getAskmoreV2Repository } from "@/server/askmore_v2/repo";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  helpful: z.boolean().nullable().optional(),
  satisfaction_score: z.number().int().min(1).max(5).nullable().optional(),
  goal_text: z.string().max(2000).nullable().optional(),
  issue_text: z.string().max(4000).nullable().optional(),
});

function toNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: NextRequest) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(request);
    if (unauthorizedResponse || !auth) return unauthorizedResponse!;

    const payload = bodySchema.parse(await request.json().catch(() => ({})));
    await ensureAskmoreV2PostgresReady();
    const repo = getAskmoreV2Repository();
    const session = await repo.getSession(payload.session_id, auth.workspace.id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.created_by_user_id && session.created_by_user_id !== auth.user.id) {
      return NextResponse.json({ error: "You can only submit feedback for your own session." }, { status: 403 });
    }

    const existing = await repo.getSessionFeedback(payload.session_id, auth.workspace.id);
    const now = new Date().toISOString();
    const feedback = {
      id: existing?.id ?? randomUUID(),
      session_id: payload.session_id,
      workspace_id: auth.workspace.id,
      user_id: auth.user.id,
      helpful: payload.helpful ?? null,
      satisfaction_score: payload.satisfaction_score ?? null,
      goal_text: toNullableText(payload.goal_text),
      issue_text: toNullableText(payload.issue_text),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    await repo.upsertSessionFeedback(feedback);
    return NextResponse.json({ feedback });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
