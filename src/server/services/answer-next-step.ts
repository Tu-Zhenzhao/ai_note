import { InterviewState, NextStep } from "@/lib/types";
import { getPreviewSlots, isSlotOpenForCompletion } from "@/server/services/preview-slots";

export function selectAnswerNextStep(params: {
  state: InterviewState;
  activeSlotIdBefore: string | null;
  activeSectionIdBefore: string;
  answeredActiveSlot: boolean;
  confirmedActiveSlot: boolean;
  confirmedSection: boolean;
}): NextStep {
  const { state } = params;
  const previewSlots = getPreviewSlots(state);
  const previousActiveSlot = params.activeSlotIdBefore
    ? previewSlots.find((slot) => slot.id === params.activeSlotIdBefore) ?? null
    : null;
  const currentTargetField = state.workflow.next_question_slot_id
    ? previewSlots.find((slot) => slot.id === state.workflow.next_question_slot_id)?.question_target_field ?? null
    : null;

  if (params.confirmedSection) {
    state.workflow.pending_confirmation_slot_id = null;
    state.workflow.pending_review_section_id = null;
    state.workflow.pending_interaction_module = null;
    return {
      response_mode: "ask_active_slot",
      target_slot_id: state.workflow.next_question_slot_id,
      target_field_path: currentTargetField,
      reason: "section_confirmation_accepted",
    };
  }

  if (
    params.answeredActiveSlot &&
    previousActiveSlot &&
    isSlotOpenForCompletion(previousActiveSlot) &&
    !params.confirmedActiveSlot
  ) {
    state.workflow.pending_confirmation_slot_id = previousActiveSlot.id;
    state.workflow.pending_interaction_module = null;
    return {
      response_mode: "confirm_active_slot",
      target_slot_id: previousActiveSlot.id,
      target_field_path: previousActiveSlot.question_target_field,
      reason: "active_slot_answer_needs_confirmation",
    };
  }

  state.workflow.pending_confirmation_slot_id = null;

  if (state.workflow.pending_review_section_id) {
    state.workflow.pending_interaction_module = "confirm_section";
    return {
      response_mode: "confirm_section",
      target_slot_id: null,
      target_field_path: null,
      reason: "section_ready_for_review",
    };
  }

  return {
    response_mode: "ask_active_slot",
    target_slot_id: state.workflow.next_question_slot_id,
    target_field_path: currentTargetField,
    reason: state.workflow.next_question_slot_id
      ? "continue_current_or_next_required_slot"
      : "no_open_required_slot",
  };
}
