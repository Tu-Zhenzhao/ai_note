import { InterviewState, ToolActionLog } from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";
import { extractStructuredUpdates } from "@/server/services/extraction";
import { recordToolTrace } from "@/server/tools/trace";

export interface ChecklistUpdateResult {
  updatedState: InterviewState;
  captured_fields_this_turn: string[];
  captured_checklist_items_this_turn: string[];
  deferred_fields: string[];
  conflicts_detected: string[];
  toolLog: ToolActionLog;
}

export async function updateChecklistAnswer(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  userMessage: string;
  state: InterviewState;
}): Promise<ChecklistUpdateResult> {
  const updates = await extractStructuredUpdates({
    userMessage: params.userMessage,
    sourceTurnId: params.turnId,
    state: params.state,
  });

  const diagnostics = params.state.system_assessment.last_turn_diagnostics;
  const toolLog = await recordToolTrace({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "checklist_updater",
    input: {
      user_message: params.userMessage,
      update_keys: Object.keys(updates),
    },
    output: {
      captured_fields_this_turn: diagnostics.captured_fields_this_turn,
      captured_checklist_items_this_turn: diagnostics.captured_checklist_items_this_turn,
      conflicts_detected: diagnostics.conflicts_detected,
    },
    success: true,
  });

  return {
    updatedState: params.state,
    captured_fields_this_turn: diagnostics.captured_fields_this_turn,
    captured_checklist_items_this_turn: diagnostics.captured_checklist_items_this_turn,
    deferred_fields: diagnostics.deferred_fields,
    conflicts_detected: diagnostics.conflicts_detected,
    toolLog,
  };
}
