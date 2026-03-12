import { InteractionModule, InterviewState, ToolActionLog } from "@/lib/types";
import { buildTurnIntent } from "@/server/agent/turn-intent";
import { InterviewRepository } from "@/server/repo/contracts";
import { extractAnswerTurn } from "@/server/services/answer-extraction";
import { selectAnswerNextStep } from "@/server/services/answer-next-step";
import { reduceAnswerTurn } from "@/server/services/answer-reducer";
import { composeAnswerTurnResponse } from "@/server/services/answer-composer";
import { openConfirmSectionInteraction } from "@/server/tools/interaction-confirm-section";
import { recordToolTrace } from "@/server/tools/trace";

export async function runAnswerTurnController(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  userMessage: string;
  state: InterviewState;
  language?: "en" | "zh";
}): Promise<{
  assistantMessage: string;
  interactionModule: InteractionModule;
  toolLogs: ToolActionLog[];
}> {
  const recentMessages = await params.repo.listMessages(params.sessionId);
  const activeSlotIdBefore = params.state.workflow.pending_confirmation_slot_id ?? params.state.workflow.next_question_slot_id;
  const activeSectionIdBefore = params.state.workflow.active_section_id;
  const sectionIndexBefore = params.state.conversation_meta.current_section_index;

  const extraction = await extractAnswerTurn({
    state: params.state,
    userMessage: params.userMessage,
    fullChatHistory: recentMessages,
  });

  const reduction = reduceAnswerTurn({
    state: params.state,
    extraction,
    sourceTurnId: params.turnId,
    userMessage: params.userMessage,
    activeSectionId: activeSectionIdBefore,
    activeSlotId: activeSlotIdBefore,
    sectionIndexBefore,
  });

  const nextStep = selectAnswerNextStep({
    state: params.state,
    activeSlotIdBefore,
    activeSectionIdBefore,
    answeredActiveSlot: reduction.extraction_contract_summary.answered_active_slot,
    confirmedActiveSlot:
      activeSlotIdBefore != null && reduction.confirmed_slot_ids.includes(activeSlotIdBefore),
    confirmedSection: reduction.confirmed_section_id != null,
  });

  const turnIntent = buildTurnIntent({
    state: params.state,
    taskType: "answer_question",
    responseMode: nextStep.response_mode,
  });
  params.state.system_assessment.last_turn_intent = turnIntent;

  let interactionModule: InteractionModule = { type: "none", payload: {} };
  const toolLogs: ToolActionLog[] = [];

  if (nextStep.response_mode === "confirm_section" && params.state.workflow.pending_review_section_id) {
    const confirmResult = await openConfirmSectionInteraction({
      repo: params.repo,
      sessionId: params.sessionId,
      turnId: params.turnId,
      state: params.state,
      sectionId: params.state.workflow.pending_review_section_id,
    });
    interactionModule = confirmResult.interactionModule;
    toolLogs.push(confirmResult.toolLog);
  }

  const assistantMessage = await composeAnswerTurnResponse({
    state: params.state,
    nextStep,
    extractionContractSummary: reduction.extraction_contract_summary,
    updatedFields: reduction.updated_fields,
    language: params.language,
    turnIntent,
  });

  const controllerLog = await recordToolTrace({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "answer_turn_controller",
    input: {
      user_message: params.userMessage,
      active_slot_before: activeSlotIdBefore,
      active_section_before: activeSectionIdBefore,
    },
    output: {
      updated_fields: reduction.updated_fields,
      confirmed_slot_ids: reduction.confirmed_slot_ids,
      confirmed_section_id: reduction.confirmed_section_id,
      next_step_mode: nextStep.response_mode,
      next_step_slot_id: nextStep.target_slot_id,
    },
    success: true,
  });
  toolLogs.unshift(controllerLog);

  return {
    assistantMessage,
    interactionModule,
    toolLogs,
  };
}
