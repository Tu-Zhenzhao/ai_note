import { ChecklistItem, InterviewState, ToolActionLog } from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";
import {
  getCurrentSectionName,
  getOpenChecklistItems,
  getCurrentSectionOpenItems,
  getCriticalOpenItems,
  getHighPriorityOpenItems,
} from "@/server/rules/checklist";
import {
  getOpenPreviewSlotsForSectionIndex,
  getPreviewSlotsForSectionIndex,
  getSectionIdForIndex,
} from "@/server/services/preview-slots";
import { recordToolTrace } from "@/server/tools/trace";

export interface ChecklistReadResult {
  active_section_index: number;
  active_section_id: string;
  active_section_name: string;
  active_section_open_checklist_items: ChecklistItem[];
  open_checklist_items: ChecklistItem[];
  critical_open_items: ChecklistItem[];
  high_open_items: ChecklistItem[];
  active_preview_slots: string[];
  active_required_open_slot_ids: string[];
  next_question_slot_id: string | null;
}

export function getChecklistState(state: InterviewState): ChecklistReadResult {
  const sectionIndex = state.conversation_meta.current_section_index;
  const activePreviewSlots = getPreviewSlotsForSectionIndex(state, sectionIndex);
  const activeRequiredOpenSlots = getOpenPreviewSlotsForSectionIndex(state, sectionIndex);

  return {
    active_section_index: sectionIndex,
    active_section_id: getSectionIdForIndex(sectionIndex),
    active_section_name: getCurrentSectionName(state),
    active_section_open_checklist_items: getCurrentSectionOpenItems(state),
    open_checklist_items: getOpenChecklistItems(state),
    critical_open_items: getCriticalOpenItems(state),
    high_open_items: getHighPriorityOpenItems(state),
    active_preview_slots: activePreviewSlots.map((slot) => slot.id),
    active_required_open_slot_ids: activeRequiredOpenSlots.map((slot) => slot.id),
    next_question_slot_id: state.workflow.next_question_slot_id,
  };
}

export async function getChecklistStateWithTrace(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
}): Promise<{ result: ChecklistReadResult; toolLog: ToolActionLog }> {
  const result = getChecklistState(params.state);
  const toolLog = await recordToolTrace({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "checklist_reader",
    input: {
      current_section_index: params.state.conversation_meta.current_section_index,
    },
    output: {
      active_section_id: result.active_section_id,
      open_checklist_items: result.open_checklist_items.length,
      active_required_open_slot_ids: result.active_required_open_slot_ids.length,
      next_question_slot_id: result.next_question_slot_id,
    },
    success: true,
  });
  return { result, toolLog };
}
