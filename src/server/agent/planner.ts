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

function looksLikeClarificationOnly(message: string): boolean {
  const raw = message.trim().toLowerCase();
  return /[?？]$/.test(raw) || /(what do you mean|can you explain|什么意思|解释一下|请说明)/i.test(raw);
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function getLatestAssistantMessage(messages: { role: "user" | "assistant" | "system"; content: string }[]): string {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return latestAssistant?.content.replace(/\s+/g, " ").trim() || "";
}

function looksLikeConfirmationPrompt(message: string): boolean {
  const value = message.toLowerCase();
  return [
    "is this accurate",
    "does this sound accurate",
    "does that feel accurate",
    "is that right",
    "is this right",
    "could you confirm",
    "please confirm",
    "是否准确",
    "是否正确",
    "你觉得这个表述是否准确",
    "请确认",
    "确认一下",
  ].some((hint) => value.includes(hint));
}

function looksLikeConfirmationAffirmation(message: string): boolean {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeForMatch(message);
  if (!raw || raw.length > 40) return false;

  const exactMatches = new Set([
    "yes",
    "yep",
    "yeah",
    "correct",
    "accurate",
    "right",
    "exactly",
    "是",
    "是的",
    "对",
    "对的",
    "没错",
    "准确",
    "正确",
    "是准确的",
    "完全准确",
  ]);
  if (exactMatches.has(raw) || exactMatches.has(normalized)) return true;

  return [
    "that is accurate",
    "sounds accurate",
    "looks accurate",
    "yes that is right",
    "yes correct",
    "完全准确",
    "是准确的",
    "这个表述准确",
    "这个说法准确",
    "这个描述准确",
  ].some((hint) => raw.includes(hint));
}

function formatRecentMessages(messages: { role: "user" | "assistant" | "system"; content: string }[]): string {
  if (messages.length === 0) return "none";
  return messages
    .map((message) => {
      const content = message.content.replace(/\s+/g, " ").trim();
      if (message.role === "user") return `user: ${content}`;
      if (message.role === "assistant") return `ai: ${content}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getLatestAssistantQuestion(messages: { role: "user" | "assistant" | "system"; content: string }[]): string {
  return getLatestAssistantMessage(messages) || "none";
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
    const latestAssistant = getLatestAssistantMessage(historyRead.messages);
    if (
      looksLikeConfirmationPrompt(latestAssistant) &&
      looksLikeConfirmationAffirmation(params.userMessage)
    ) {
      return {
        classification: {
          task_type: "answer_question",
          rationale: "User provided an explicit confirmation reply while workflow is awaiting section confirmation.",
        },
        plannerTrace: {
          strategy: "confirming_section_affirmation",
          workflow_phase: params.state.workflow.phase,
        },
        toolLogs: [checklistRead.toolLog, historyRead.toolLog],
      };
    }
    if (looksLikeHelpRequest(params.userMessage)) {
      return {
        classification: {
          task_type: "ask_for_help",
          rationale: "User requested help while reviewing the current section.",
        },
        plannerTrace: {
          strategy: "confirming_section_help_request",
          workflow_phase: params.state.workflow.phase,
        },
        toolLogs: [checklistRead.toolLog, historyRead.toolLog],
      };
    }
    if (looksLikeClarificationOnly(params.userMessage)) {
      return {
        classification: {
          task_type: "other_discussion",
          rationale: "User is asking for clarification while workflow is waiting on section confirmation.",
        },
        plannerTrace: {
          strategy: "confirming_section_clarification",
          workflow_phase: params.state.workflow.phase,
        },
        toolLogs: [checklistRead.toolLog, historyRead.toolLog],
      };
    }
    return {
      classification: {
        task_type: "answer_question",
        rationale: "Treat section-review edits and confirmations as answer flow so state can update deterministically.",
      },
      plannerTrace: {
        strategy: "confirming_section_answer_default",
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
    const recentMessages = formatRecentMessages(historyRead.messages);
    const latestAssistantQuestion = getLatestAssistantQuestion(historyRead.messages);
    const classification = await generateModelObject({
      system: [
        "You classify user turns for a deterministic interview agent.",
        "Return only task_type and rationale. task_type must be one of: answer_question, ask_for_help, other_discussion.",
        "You must inspect the recent chat history, especially the latest assistant question, before classifying.",
        "Choose answer_question when the user is answering or attempting to answer the latest active question, even if the answer is partial, verbose, nuanced, mixed with explanation, reflective, or somewhat off-structure.",
        "Do not classify as other_discussion merely because the answer is broad, exploratory, indirect, contextual, or includes extra commentary.",
        "Choose ask_for_help only when the user is explicitly asking for suggestions, ideas, or help answering.",
        "Use other_discussion only when the user is clearly not answering the active question and is instead starting a side discussion, free talk, brainstorming session, or clarification-only exchange.",
        "If the latest assistant turn asked a concrete question and the user reply is plausibly relevant to it, prefer answer_question.",
        "If uncertain between answer_question and other_discussion, choose answer_question.",
      ].join(" "),
      prompt: [
        `User message: ${params.userMessage}`,
        `Current workflow phase: ${params.state.workflow.phase}`,
        `Active section: ${checklistRead.result.active_section_name}`,
        `Active required blockers: ${checklistRead.result.active_required_open_slot_ids.join(", ") || "none"}`,
        `Recent unresolved conflicts: ${historyRead.unresolved_conflicts.length}`,
        `Latest assistant question: ${latestAssistantQuestion}`,
        `Recent chat history:\n${recentMessages}`,
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
