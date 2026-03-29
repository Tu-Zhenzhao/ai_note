import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { createAiThinking, listAiThinkingRuns, startAiThinkingJob } from "@/server/askmore_v2/insight/service";
import { requireApiAuth } from "@/server/auth/api-auth";

const postSchema = z.object({
  session_id: z.string().uuid(),
  language: z.enum(["en", "zh"]).optional(),
  force_regenerate: z.boolean().optional().default(false),
  async_mode: z.boolean().optional().default(false),
  pack_config: z.object({
    corePack: z.string().min(1).optional(),
    domainPack: z.string().min(1).optional(),
    subdomainPacks: z.array(z.string().min(1)).optional(),
    stylePack: z.string().min(1).optional(),
    safetyPack: z.string().min(1).optional(),
  }).optional(),
});

const getQuerySchema = z.object({
  session_id: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export async function POST(request: NextRequest) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(request);
    if (unauthorizedResponse || !auth) return unauthorizedResponse!;
    const payload = postSchema.parse(await request.json());
    await ensureAskmoreV2PostgresReady();
    if (payload.async_mode) {
      const job = await startAiThinkingJob({
        sessionId: payload.session_id,
        workspaceId: auth.workspace.id,
        language: payload.language,
        trigger: "manual",
        forceRegenerate: payload.force_regenerate,
        packConfig: payload.pack_config,
      });
      return NextResponse.json(job, { status: 202 });
    }
    const result = await createAiThinking({
      sessionId: payload.session_id,
      workspaceId: auth.workspace.id,
      language: payload.language,
      trigger: "manual",
      forceRegenerate: payload.force_regenerate,
      packConfig: payload.pack_config,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const code = (error as { code?: string } | null)?.code;
    return NextResponse.json(
      { error: message, ...(code ? { error_code: code } : {}) },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { auth, unauthorizedResponse } = await requireApiAuth(request);
    if (unauthorizedResponse || !auth) return unauthorizedResponse!;
    const url = new URL(request.url);
    const query = getQuerySchema.parse({
      session_id: url.searchParams.get("session_id"),
      limit: url.searchParams.get("limit") ?? undefined,
    });
    await ensureAskmoreV2PostgresReady();
    const result = await listAiThinkingRuns({
      sessionId: query.session_id,
      workspaceId: auth.workspace.id,
      limit: query.limit,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid query" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
