import { InteractionModule, InterviewState, PreviewSectionId, ToolActionLog } from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";
import { getSectionNameForIndex, PREVIEW_SECTION_ORDER } from "@/server/services/preview-slots";
import { syncWorkflowState } from "@/server/services/workflow";
import { recordToolTrace } from "@/server/tools/trace";

function sectionIndexById(sectionId: PreviewSectionId) {
  return PREVIEW_SECTION_ORDER.findIndex((section) => section.id === sectionId);
}

export async function openConfirmSectionInteraction(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
  sectionId?: PreviewSectionId;
}): Promise<{ interactionModule: InteractionModule; toolLog: ToolActionLog }> {
  const currentSectionIndex = params.state.conversation_meta.current_section_index;
  const chosenSectionId = params.sectionId ?? params.state.workflow.active_section_id;
  const sectionIndex = sectionIndexById(chosenSectionId);

  params.state.workflow.pending_review_section_id = chosenSectionId;
  params.state.workflow.pending_interaction_module = "confirm_section";
  params.state.workflow.phase = "confirming_section";
  params.state.workflow.transition_allowed = false;
  params.state.workflow.last_transition_reason = "section_ready_for_confirmation";
  syncWorkflowState(params.state);

  const interactionModule: InteractionModule = {
    type: "confirm_section",
    payload: {
      section_id: chosenSectionId,
      section_name: getSectionNameForIndex(sectionIndex >= 0 ? sectionIndex : currentSectionIndex),
      current_section_index: currentSectionIndex,
    },
  };

  const toolLog = await recordToolTrace({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "interaction_confirm_section",
    input: {
      section_id: chosenSectionId,
    },
    output: interactionModule.payload,
    success: true,
  });

  return { interactionModule, toolLog };
}
