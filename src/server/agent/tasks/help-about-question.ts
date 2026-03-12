import { z } from "zod";
import { InteractionModule, InterviewState, ToolActionLog } from "@/lib/types";
import { generateModelObject } from "@/server/model/adapters";
import { InterviewRepository } from "@/server/repo/contracts";
import { generateAssistantResponse } from "@/server/services/assistant";
import { getTargetFieldForSlotId } from "@/server/services/preview-slots";
import { openOptionSelection } from "@/server/tools/interaction-select-option";

const helpSuggestionSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(3).max(5),
});

export interface HelpAboutQuestionResult {
  assistantMessage: string;
  interactionModule: InteractionModule;
  toolLogs: ToolActionLog[];
}

function fallbackSuggestions(targetField: string) {
  return {
    prompt: `Choose the option closest to your answer for ${targetField.replaceAll("_", " ")}.`,
    options: [
      "Option A: practical and straightforward",
      "Option B: authority-driven and expert-focused",
      "Option C: educational and audience-first",
    ],
  };
}

export async function runHelpAboutQuestionTask(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  userMessage: string;
  state: InterviewState;
}): Promise<HelpAboutQuestionResult> {
  const slotId = params.state.workflow.next_question_slot_id ?? "unknown_slot";
  const targetField = getTargetFieldForSlotId(params.state, slotId) ?? "the current strategic question";

  let suggestions = fallbackSuggestions(targetField);
  try {
    suggestions = await generateModelObject({
      system:
        "Generate structured answer options for a strategic interview. Return concise options that the user can directly pick.",
      prompt: [
        `User asks for help: ${params.userMessage}`,
        `Active target field: ${targetField}`,
        "Return 3-5 short options and a concise prompt.",
      ].join("\n"),
      schema: helpSuggestionSchema,
    });
  } catch {
    // Keep deterministic fallback if model is unavailable.
  }

  const options = suggestions.options.map((option, idx) => ({
    id: `opt_${idx + 1}`,
    label: option,
    value: option,
  }));

  const interactionResult = await openOptionSelection({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    state: params.state,
    slotId,
    prompt: suggestions.prompt,
    options,
    allowOther: true,
    otherPlaceholder: "Write your own answer if none fit.",
  });

  const recentMessages = await params.repo.listMessages(params.sessionId);
  const assistantMessage = await generateAssistantResponse({
    state: params.state,
    userMessage: params.userMessage,
    nextQuestion: `${suggestions.prompt} Pick one option or write your own.`,
    questionType: "ai_suggest",
    taskType: "ask_for_help",
    plannerAction: "ask",
    questionStyle: "guided_choice",
    recentMessages,
    workflowState: params.state.workflow,
  });

  return {
    assistantMessage,
    interactionModule: interactionResult.interactionModule,
    toolLogs: [interactionResult.toolLog],
  };
}
