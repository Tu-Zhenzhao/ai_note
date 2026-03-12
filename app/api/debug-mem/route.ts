import { NextResponse } from "next/server";
import { getInterviewRepository } from "@/server/repo";

export async function GET(request: Request) {
  const mem = process.memoryUsage();
  let heapLimitMB = "unknown";
  try { heapLimitMB = (require("v8").getHeapStatistics().heap_size_limit / 1024 / 1024).toFixed(0); } catch {}

  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");

  let stateInfo: Record<string, unknown> = {};
  if (sid) {
    try {
      const repo = getInterviewRepository();
      const rec = await repo.getState(sid);
      if (rec) {
        const fullJson = JSON.stringify(rec.state_jsonb);
        const previewProjJson = JSON.stringify(rec.state_jsonb.preview_projection ?? {});
        const sysAssessJson = JSON.stringify(rec.state_jsonb.system_assessment ?? {});
        const checklistJson = JSON.stringify(rec.state_jsonb.checklist ?? []);
        const previewJson = JSON.stringify(rec.preview_jsonb ?? {});
        stateInfo = {
          stateKB: (fullJson.length / 1024).toFixed(1),
          previewProjectionKB: (previewProjJson.length / 1024).toFixed(1),
          systemAssessmentKB: (sysAssessJson.length / 1024).toFixed(1),
          checklistKB: (checklistJson.length / 1024).toFixed(1),
          previewJsonbKB: (previewJson.length / 1024).toFixed(1),
          slotsCount: rec.state_jsonb.system_assessment?.preview_slots?.length ?? 0,
          revLogLen: rec.state_jsonb.preview_projection?.preview_revision_log?.length ?? 0,
          conflictsLen: rec.state_jsonb.system_assessment?.pending_conflicts?.length ?? 0,
          turnCount: rec.state_jsonb.conversation_meta?.current_section_turn_count ?? "N/A",
        };
      } else {
        stateInfo = { error: "session not found" };
      }
    } catch (e) {
      stateInfo = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({
    heapUsedMB: (mem.heapUsed / 1048576).toFixed(1),
    heapTotalMB: (mem.heapTotal / 1048576).toFixed(1),
    rssMB: (mem.rss / 1048576).toFixed(1),
    heapLimitMB,
    pid: process.pid,
    uptimeSec: process.uptime().toFixed(0),
    stateInfo,
  });
}
