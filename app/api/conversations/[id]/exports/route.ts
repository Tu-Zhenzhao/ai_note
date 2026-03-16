import { NextResponse } from "next/server";
import { ensureSuperV1PostgresReady } from "@/server/superv1/db-preflight";
import { normalizeSuperV1Error } from "@/server/superv1/runtime-errors";
import {
  buildSuperV1Export,
  isSuperV1ExportFormat,
} from "@/server/superv1/services/export-service";
import { traceRunEnd, traceRunStart } from "@/server/tools/runtime-trace";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const traceCtx = { runtime: "route.superv1.exports.get" } as const;
  const params = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format");

  if (!isSuperV1ExportFormat(format)) {
    return NextResponse.json(
      {
        error:
          "Invalid export format. Use one of: chat_history_txt, question_sheet_md, question_sheet_txt, ai_direction_report_md",
      },
      { status: 400 },
    );
  }

  try {
    traceRunStart(traceCtx);
    await ensureSuperV1PostgresReady();
    const result = await buildSuperV1Export(params.id, format);
    traceRunEnd(traceCtx, {
      status: "ok",
      durationMs: Date.now() - startedAt,
      summary: {
        conversation_id: params.id,
        format,
        filename: result.filename,
      },
    });
    return new NextResponse(result.body, {
      status: 200,
      headers: {
        "Content-Type": `${result.contentType}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const normalized = normalizeSuperV1Error(error);
    traceRunEnd(traceCtx, {
      status: "fail",
      durationMs: Date.now() - startedAt,
      summary: {
        conversation_id: params.id,
        format,
        code: normalized.code,
        error_message: normalized.message,
      },
    });
    return NextResponse.json(
      {
        error: normalized.message,
        code: normalized.code,
        ...(normalized.details ? { details: normalized.details } : {}),
      },
      { status: normalized.status },
    );
  }
}

