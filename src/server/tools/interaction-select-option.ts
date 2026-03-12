import {
  InteractionModule,
  InterviewState,
  StructuredChoiceOption,
  ToolActionLog,
} from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";
import { syncWorkflowState } from "@/server/services/workflow";
import { recordToolTrace } from "@/server/tools/trace";

export async function openOptionSelection(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
  slotId: string;
  prompt: string;
  options: StructuredChoiceOption[];
  allowOther?: boolean;
  otherPlaceholder?: string;
}): Promise<{ interactionModule: InteractionModule; toolLog: ToolActionLog }> {
  params.state.workflow.pending_interaction_module = "select_help_option";
  params.state.workflow.phase = "structured_help_selection";
  params.state.workflow.transition_allowed = false;
  params.state.workflow.last_transition_reason = "awaiting_help_option_selection";
  syncWorkflowState(params.state);

  const interactionModule: InteractionModule = {
    type: "select_help_option",
    payload: {
      slot_id: params.slotId,
      prompt: params.prompt,
      options: params.options,
      allow_other: params.allowOther ?? true,
      other_placeholder: params.otherPlaceholder ?? "Or write your own answer...",
    },
  };

  const toolLog = await recordToolTrace({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "interaction_select_option",
    input: {
      slot_id: params.slotId,
      options_count: params.options.length,
      allow_other: params.allowOther ?? true,
    },
    output: interactionModule.payload,
    success: true,
  });

  return { interactionModule, toolLog };
}
