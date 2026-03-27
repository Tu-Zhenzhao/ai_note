import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureAskmoreV2PostgresReady } from "@/server/askmore_v2/db-preflight";
import { getAiThinkingJob } from "@/server/askmore_v2/insight/service";

const getQuerySchema = z.object({
  job_id: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const query = getQuerySchema.parse({
      job_id: url.searchParams.get("job_id"),
    });
    await ensureAskmoreV2PostgresReady();
    const job = getAiThinkingJob(query.job_id);
    if (!job) {
      return NextResponse.json({ error: "Job not found", error_code: "job_not_found" }, { status: 404 });
    }
    return NextResponse.json({
      job_meta: job,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid query" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
