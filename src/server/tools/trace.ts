import { randomUUID } from "crypto";
import { ToolActionLog } from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";

const MAX_PAYLOAD_CHARS = 8_000;

function capPayload(obj: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(obj);
  if (serialized.length <= MAX_PAYLOAD_CHARS) return obj;
  return { _truncated: true, _original_size: serialized.length, summary: serialized.slice(0, MAX_PAYLOAD_CHARS) };
}

export async function recordToolTrace(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  success: boolean;
}): Promise<ToolActionLog> {
  const log: ToolActionLog = {
    id: randomUUID(),
    session_id: params.sessionId,
    turn_id: params.turnId,
    tool_name: params.toolName,
    input_json: capPayload(params.input),
    output_json: capPayload(params.output),
    success: params.success,
    created_at: new Date().toISOString(),
  };
  await params.repo.addToolActionLog(log);
  return log;
}
