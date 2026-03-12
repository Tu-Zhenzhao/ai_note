import { InterviewState, PreviewSectionId } from "@/lib/types";
import {
  PREVIEW_SECTION_ORDER,
  getOpenPreviewSlotsForSectionIndex,
  getSectionIdForIndex,
  selectNextPreviewSlot,
  syncPreviewSlots,
} from "@/server/services/preview-slots";

const SECTION_INDEX_BY_ID: Record<PreviewSectionId, number> = PREVIEW_SECTION_ORDER.reduce(
  (acc, section, index) => {
    acc[section.id] = index;
    return acc;
  },
  {} as Record<PreviewSectionId, number>,
);

export function syncWorkflowState(state: InterviewState) {
  syncPreviewSlots(state);
  const currentIndex = state.conversation_meta.current_section_index;
  const activeSectionId = getSectionIdForIndex(currentIndex);
  const openRequired = getOpenPreviewSlotsForSectionIndex(state, currentIndex);
  const nextSlot = selectNextPreviewSlot(state);

  state.workflow.active_section_id = activeSectionId;
  state.workflow.required_open_slot_ids = openRequired.map((slot) => slot.id);
  state.workflow.next_question_slot_id = nextSlot?.id ?? null;

  if (state.workflow.pending_interaction_module === "select_help_option") {
    state.workflow.phase = "structured_help_selection";
    state.workflow.transition_allowed = false;
    state.workflow.last_transition_reason = "awaiting_help_option_selection";
    return state.workflow;
  }

  if (
    state.workflow.pending_review_section_id &&
    state.workflow.pending_review_section_id === activeSectionId &&
    openRequired.length === 0
  ) {
    state.workflow.phase = "confirming_section";
    state.workflow.pending_interaction_module = "confirm_section";
    state.workflow.transition_allowed = false;
    state.workflow.last_transition_reason = "awaiting_section_confirmation";
    return state.workflow;
  }

  if (state.workflow.pending_review_section_id && openRequired.length > 0) {
    state.workflow.pending_review_section_id = null;
    state.workflow.pending_interaction_module = null;
  }

  if (openRequired.length === 0) {
    state.workflow.phase = "confirming_section";
    state.workflow.pending_review_section_id = activeSectionId;
    state.workflow.pending_interaction_module = "confirm_section";
    state.workflow.transition_allowed = false;
    state.workflow.last_transition_reason = "section_ready_for_confirmation";
    return state.workflow;
  }

  if (state.system_assessment.next_action === "checkpoint") {
    state.workflow.pending_interaction_module = null;
    state.workflow.phase = "checkpoint";
    state.workflow.transition_allowed = false;
    state.workflow.last_transition_reason = "checkpoint_recommended";
    return state.workflow;
  }

  if (state.system_assessment.next_action === "generate_brief") {
    state.workflow.pending_interaction_module = null;
    state.workflow.phase = "generation_ready";
    state.workflow.transition_allowed = false;
    state.workflow.last_transition_reason = "generation_ready";
    return state.workflow;
  }

  if (state.system_assessment.next_action === "handoff") {
    state.workflow.pending_interaction_module = null;
    state.workflow.phase = "handoff";
    state.workflow.transition_allowed = false;
    state.workflow.last_transition_reason = "handoff_required";
    return state.workflow;
  }

  state.workflow.pending_interaction_module = null;
  state.workflow.phase = "interviewing";
  state.workflow.transition_allowed = false;
  state.workflow.last_transition_reason = state.workflow.pending_confirmation_slot_id
    ? `awaiting_slot_confirmation:${state.workflow.pending_confirmation_slot_id}`
    : openRequired[0]
      ? `still_waiting_on:${openRequired[0].question_label}`
      : "required_slots_open";
  return state.workflow;
}

export function confirmPendingSectionAndAdvance(state: InterviewState, sectionId: PreviewSectionId) {
  if (state.workflow.pending_review_section_id !== sectionId) {
    return false;
  }

  const currentIndex = SECTION_INDEX_BY_ID[sectionId];
  const nextIndex = Math.min(currentIndex + 1, PREVIEW_SECTION_ORDER.length - 1);
  state.conversation_meta.current_section_index = nextIndex;
  state.conversation_meta.current_section_turn_count = 0;
  state.workflow.pending_review_section_id = null;
  state.workflow.pending_confirmation_slot_id = null;
  state.workflow.pending_interaction_module = null;
  state.workflow.active_section_id = getSectionIdForIndex(nextIndex);
  state.workflow.transition_allowed = true;
  state.workflow.last_transition_reason = "section_confirmed_by_user";
  state.workflow.phase = "interviewing";
  syncWorkflowState(state);
  return true;
}
