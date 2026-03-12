import { z } from "zod";
import { InterviewState, PlannerClassification, ToolActionLog } from "@/lib/types";
import { generateModelObject } from "@/server/model/adapters";
import { InterviewRepository } from "@/server/repo/contracts";
import { getChecklistStateWithTrace } from "@/server/tools/checklist-reader";
import { getHistoryContext } from "@/server/tools/history-reader";

const plannerClassificationSchema = z.object({
  task_type: z.enum(["answer_question", "ask_for_help", "other_discussion"]),
  rationale: z.string().min(1),
});

function looksLikeHelpRequest(message: string): boolean {
  const value = message.toLowerCase();
  return [
    "not sure",
    "don't know",
    "help me",
    "any idea",
    "suggest",
    "what should i",
    "can you help",
  ].some((hint) => value.includes(hint));
}

function looksLikeSelection(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 220;
}

export interface PlannerStepResult {
  classification: PlannerClassification;
  plannerTrace: Record<string, unknown>;
  toolLogs: ToolActionLog[];
}

export async function classifyTurn(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  userMessage: string;
  state: InterviewState;
}): Promise<PlannerStepResult> {
  const checklistRead = await getChecklistStateWithTrace({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    state: params.state,
  });
  const historyRead = await getHistoryContext({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    query: params.userMessage,
    state: params.state,
    limit: 6,
  });

  if (params.state.workflow.phase === "confirming_section") {
    return {
      classification: {
        task_type: "other_discussion",
        rationale: "Workflow is waiting on section confirmation.",
      },
      plannerTrace: {
        strategy: "workflow_guardrail",
        workflow_phase: params.state.workflow.phase,
      },
      toolLogs: [checklistRead.toolLog, historyRead.toolLog],
    };
  }

  if (params.state.workflow.phase === "structured_help_selection") {
    return {
      classification: {
        task_type: looksLikeSelection(params.userMessage) ? "answer_question" : "other_discussion",
        rationale: looksLikeSelection(params.userMessage)
          ? "User provided a candidate option/answer during structured help selection."
          : "User is still discussing while in structured help selection mode.",
      },
      plannerTrace: {
        strategy: "help_selection_guardrail",
        workflow_phase: params.state.workflow.phase,
      },
      toolLogs: [checklistRead.toolLog, historyRead.toolLog],
    };
  }

  if (looksLikeHelpRequest(params.userMessage)) {
    return {
      classification: {
        task_type: "ask_for_help",
        rationale: "Message explicitly asks for help or suggestions.",
      },
      plannerTrace: {
        strategy: "heuristic_help_request",
      },
      toolLogs: [checklistRead.toolLog, historyRead.toolLog],
    };
  }

  try {
    const classification = await generateModelObject({
      system:
        "You classify user turns for a deterministic interview agent. Return only task_type and rationale. task_type must be one of: answer_question, ask_for_help, other_discussion.",
      prompt: [
        `User message: ${params.userMessage}`,
        `Current workflow phase: ${params.state.workflow.phase}`,
        `Active section: ${checklistRead.result.active_section_name}`,
        `Active required blockers: ${checklistRead.result.active_required_open_slot_ids.join(", ") || "none"}`,
        `Recent unresolved conflicts: ${historyRead.unresolved_conflicts.length}`,
      ].join("\n"),
      schema: plannerClassificationSchema,
    });

    return {
      classification,
      plannerTrace: {
        strategy: "model_classification",
      },
      toolLogs: [checklistRead.toolLog, historyRead.toolLog],
    };
  } catch {
    return {
      classification: {
        task_type: "answer_question",
        rationale: "Fallback to answer path when classification model is unavailable.",
      },
      plannerTrace: {
        strategy: "fallback_answer_question",
      },
      toolLogs: [checklistRead.toolLog, historyRead.toolLog],
    };
  }
}
