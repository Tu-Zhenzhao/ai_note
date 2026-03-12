import { InterviewState, ResponseMode, TaskType, TurnIntent } from "@/lib/types";
import { getPreviewSlots, getTargetFieldForSlotId } from "@/server/services/preview-slots";

export function buildTurnIntent(params: {
  state: InterviewState;
  taskType: TaskType;
  responseMode: ResponseMode;
}): TurnIntent {
  const { state, taskType, responseMode } = params;
  const activeSectionId = state.workflow.active_section_id;
  const activeSlotId = state.workflow.next_question_slot_id;
  const slots = getPreviewSlots(state);
  const activeSlotTargetField = activeSlotId
    ? getTargetFieldForSlotId(state, activeSlotId)
    : null;
  const sameSectionSupportingTargets = slots
    .filter((slot) => slot.section === activeSectionId && slot.id !== activeSlotId)
    .map((slot) => slot.id);
  const outOfSectionTargets = slots
    .filter((slot) => slot.section !== activeSectionId)
    .map((slot) => slot.id);
  const allowedTargets = activeSlotId
    ? [activeSlotId]
    : state.workflow.required_open_slot_ids.slice(0, 1);
  const forbiddenTargets =
    responseMode === "ask_active_slot"
      ? [...sameSectionSupportingTargets, ...outOfSectionTargets]
      : outOfSectionTargets;

  return {
    active_section_id: activeSectionId,
    active_slot_id: activeSlotId,
    active_slot_target_field: activeSlotTargetField,
    workflow_phase: state.workflow.phase,
    task_type: taskType,
    interaction_required: state.workflow.pending_interaction_module != null,
    can_transition: state.workflow.transition_allowed,
    allowed_question_targets: allowedTargets,
    allowed_supporting_targets: sameSectionSupportingTargets,
    forbidden_question_targets: forbiddenTargets,
    response_mode: responseMode,
  };
}
