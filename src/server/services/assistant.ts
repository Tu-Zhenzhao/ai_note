import {
  InterviewMessage,
  InterviewState,
  InterviewWorkflowState,
  PlannerAction,
  PreviewSectionId,
  PreviewSlot,
  QuestionStyle,
  QuestionType,
  TaskType,
  TurnIntent,
} from "@/lib/types";
import { generateModelText } from "@/server/model/adapters";
import { interviewSystemPrompt, interviewUserPrompt, loadTaskPrompt, TaskPromptKey } from "@/server/prompts/interview";
import { getCurrentSectionName } from "@/server/rules/checklist";
import { getPreviewSlots, PREVIEW_SECTION_ORDER } from "@/server/services/preview-slots";

function humanizeSchemaText(text: string): string {
  return text
    .replace(/\b[a-z_]+\.(\w+)\b/g, (_, field: string) =>
      field.replace(/_/g, " "),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeQuestion(question: string): string {
  const humanized = humanizeSchemaText(question)
    .replace(/^confirm\s+/i, "Could you confirm ")
    .replace(/^could you confirm could you confirm/i, "Could you confirm");
  const firstQuestionMark = humanized.indexOf("?");
  const trimmed =
    firstQuestionMark >= 0
      ? humanized.slice(0, firstQuestionMark + 1)
      : `${humanized.replace(/[.]+$/, "")}?`;
  return trimmed;
}

function sectionNameFromId(sectionId: string | null | undefined): string {
  if (!sectionId) return "Current section";
  return PREVIEW_SECTION_ORDER.find((section) => section.id === sectionId)?.name ?? "Current section";
}

function stripUnauthorizedTransitions(text: string, allowTransition: boolean): { text: string; removed: boolean } {
  if (allowTransition) return { text: text.trim(), removed: false };
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const blocked = /(that\s+completes|section\s+done|let'?s\s+move|moving\s+on|we\s+are\s+now\s+(officially\s+)?in|我们现在正处于|我们已经.*(梳理|完成)|接下来.*(目标受众|下一部分|下一阶段)|现在.*(进入|转向).*(受众洞察|下一部分)|我们把视角从|现在我们.*(把目光转向|转向))/i;
  const kept = sentences.filter((sentence) => !blocked.test(sentence));
  return { text: kept.join(" ").trim(), removed: kept.length !== sentences.length };
}

/**
 * @deprecated No longer prepended to responses — section status is now shown
 * as a UI header in the chat panel instead.
 */
function _deterministicWorkflowLine(workflow: InterviewWorkflowState, fallbackSectionName: string): string {
  const sectionName = sectionNameFromId(workflow.active_section_id) || fallbackSectionName;
  if (workflow.phase === "confirming_section") {
    const pending = sectionNameFromId(workflow.pending_review_section_id);
    return `We are confirming ${pending || sectionName} before moving on.`;
  }
  return `We're still in ${sectionName}.`;
}

function minimalFallback(params: {
  nextQuestion: string;
  capturedFieldsThisTurn: string[];
  currentSectionName: string;
  state: InterviewState;
  language?: "en" | "zh";
  userFacingProgressNote?: string;
}): string {
  const captured = params.capturedFieldsThisTurn.length;
  const isZh = params.language === "zh";
  const ack = isZh
    ? captured > 1
      ? "明白了。"
      : captured > 0
        ? "收到。"
        : "我理解。"
    : captured > 1
      ? "Understood."
      : captured > 0
        ? "Got it."
        : "I see.";
  const question = isZh ? params.nextQuestion : sanitizeQuestion(params.nextQuestion);
  return `${ack} ${question}`;
}

function fallbackQuestionFromSlotId(slotId: string | null, language?: "en" | "zh"): string {
  if (language !== "zh") return "";
  const zhQuestionMap: Record<string, string> = {
    "company_understanding.company_summary": "请你再用一句话概括：你们公司到底做什么？",
    "company_understanding.brand_story": "你们最核心的品牌信念是什么？希望别人记住你们什么？",
    "company_understanding.main_offering": "你们的核心产品或服务具体是什么？",
    "company_understanding.problem_solved": "你们主要解决客户的什么问题？",
    "company_understanding.differentiator": "和其他替代方案相比，你们最不一样的地方是什么？",
    "audience_understanding.primary_audience": "你们最核心的目标受众是谁？",
    "audience_understanding.core_problems": "这类受众今天最常见的痛点是什么？",
    "audience_understanding.desired_outcomes": "他们最想获得的结果是什么？",
    "audience_understanding.linkedin_attraction_goal": "在 LinkedIn 上你最希望吸引哪类人？",
  };
  if (!slotId) return "请补充当前这个问题的关键信息。";
  return zhQuestionMap[slotId] ?? "请补充当前这个问题的关键信息。";
}

function deterministicContractFallback(params: {
  state: InterviewState;
  turnIntent?: TurnIntent;
  nextQuestion: string;
  language?: "en" | "zh";
}): string {
  if (params.turnIntent?.response_mode === "confirm_section") {
    return params.language === "zh"
      ? "请先确认当前板块内容是否准确，或告诉我需要修改的地方。"
      : "Please confirm the current section or tell me what to adjust.";
  }
  const slotFallback = fallbackQuestionFromSlotId(params.turnIntent?.active_slot_id ?? null, params.language);
  if (slotFallback) return slotFallback;
  const activeSlot = params.turnIntent?.active_slot_id
    ? getPreviewSlots(params.state).find((slot) => slot.id === params.turnIntent?.active_slot_id) ?? null
    : null;
  if (activeSlot && params.language !== "zh") {
    return sanitizeQuestion(activeSlot.question_label);
  }
  return params.language === "zh"
    ? "请继续补充当前这个问题。"
    : sanitizeQuestion(params.nextQuestion);
}

const SLOT_STOPWORDS = new Set([
  "what",
  "which",
  "who",
  "how",
  "does",
  "do",
  "the",
  "your",
  "you",
  "for",
  "and",
  "are",
  "with",
  "from",
  "that",
  "this",
  "have",
  "into",
  "through",
  "their",
  "they",
  "them",
  "should",
  "would",
  "could",
  "most",
  "today",
  "make",
  "like",
  "feel",
  "want",
  "need",
  "main",
  "first",
]);

const SECTION_ALIASES: Record<PreviewSectionId, string[]> = {
  company_understanding: ["company understanding", "company summary", "公司概况"],
  audience_understanding: ["audience understanding", "target audience", "受众洞察", "目标受众"],
  linkedin_content_strategy: ["linkedin content strategy", "linkedin strategy", "linkedin 内容策略"],
  evidence_and_proof_assets: ["evidence and proof", "proof assets", "证据与案例资产", "案例资产"],
  content_preferences_and_boundaries: ["content preferences", "content boundaries", "内容偏好", "内容边界"],
  generation_plan: ["generation plan", "first piece", "生成计划", "首篇内容"],
};

const SLOT_ALIASES: Record<string, string[]> = {
  "company_understanding.company_summary": ["company does", "一句话概括", "公司到底做什么"],
  "company_understanding.brand_story": ["core belief", "remember most", "品牌信念", "记住你们什么"],
  "company_understanding.main_offering": ["product or service", "main offering", "核心产品", "核心服务"],
  "company_understanding.problem_solved": ["problem does the product solve", "解决客户的什么问题", "什么问题"],
  "company_understanding.differentiator": ["different from alternatives", "最不一样", "差异化"],
  "audience_understanding.primary_audience": ["primary audience", "target audience", "目标受众是谁", "哪类受众"],
  "audience_understanding.core_problems": ["struggle with today", "常见的痛点", "痛点是什么"],
  "audience_understanding.desired_outcomes": ["outcomes do they want", "想获得的结果", "结果是什么"],
  "audience_understanding.linkedin_attraction_goal": [
    "attract on linkedin",
    "吸引哪类人",
    "在 linkedin 上你最希望吸引哪类人",
  ],
};

function tokenizeForSlotMatching(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !SLOT_STOPWORDS.has(token)),
    ),
  );
}

function buildSlotKeywords(slot: PreviewSlot): string[] {
  const targetField = slot.question_target_field.replace(/[._]/g, " ");
  return tokenizeForSlotMatching(
    [slot.label, slot.question_label, slot.question_intent, targetField, slot.id.replace(/[._]/g, " ")].join(" "),
  );
}

function scoreSlotAgainstText(slot: PreviewSlot, text: string): number {
  const normalized = text.toLowerCase();
  const textTokens = new Set(tokenizeForSlotMatching(text));
  let score = 0;

  const normalizedQuestionLabel = slot.question_label.toLowerCase().replace(/[?？]/g, "");
  if (normalizedQuestionLabel && normalized.includes(normalizedQuestionLabel)) score += 4;
  if (slot.label && normalized.includes(slot.label.toLowerCase())) score += 2;
  for (const alias of SLOT_ALIASES[slot.id] ?? []) {
    if (normalized.includes(alias.toLowerCase())) score += 3;
  }

  for (const keyword of buildSlotKeywords(slot)) {
    if (textTokens.has(keyword)) score += 1;
  }

  return score;
}

function inferTargetSlotId(params: {
  state: InterviewState;
  text: string;
}): string | null {
  const slots = getPreviewSlots(params.state);
  let best: { id: string | null; score: number } = { id: null, score: 0 };
  let runnerUpScore = 0;

  for (const slot of slots) {
    const score = scoreSlotAgainstText(slot, params.text);
    if (score > best.score) {
      runnerUpScore = best.score;
      best = { id: slot.id, score };
      continue;
    }
    if (score > runnerUpScore) runnerUpScore = score;
  }

  if (!best.id || best.score < 2 || best.score === runnerUpScore) return null;
  return best.id;
}

function extractQuestionSentences(text: string): string[] {
  return text
    .split(/(?<=[?？])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[?？]/.test(sentence));
}

function findMentionedForeignSectionIds(text: string, activeSectionId: PreviewSectionId): PreviewSectionId[] {
  const normalized = text.toLowerCase();
  return PREVIEW_SECTION_ORDER
    .filter((section) => section.id !== activeSectionId)
    .filter((section) =>
      (SECTION_ALIASES[section.id] ?? []).some((alias) => normalized.includes(alias.toLowerCase())),
    )
    .map((section) => section.id);
}

function validateAgainstTurnIntent(params: {
  state: InterviewState;
  response: string;
  turnIntent?: TurnIntent;
}): { valid: boolean; violations: string[]; inferred_target_slot_id: string | null } {
  const intent = params.turnIntent;
  if (!intent) return { valid: true, violations: [], inferred_target_slot_id: null };
  const violations: string[] = [];
  const questionSentences = extractQuestionSentences(params.response);
  const questionText = questionSentences[questionSentences.length - 1] ?? "";
  const inferredTargetSlotId = questionText
    ? inferTargetSlotId({ state: params.state, text: questionText })
    : null;

  if (intent.response_mode === "confirm_section") {
    if (questionSentences.length > 0 && !/(confirm|确认|edit|adjust|修改)/i.test(params.response)) {
      violations.push("confirm_mode_violation");
    }
  }

  if (intent.response_mode === "ask_active_slot") {
    if (questionSentences.length === 0) {
      violations.push("no_question_in_ask_mode");
    }
    if (questionSentences.length > 1) {
      violations.push("multiple_questions");
    }
    if (
      inferredTargetSlotId &&
      intent.active_slot_id &&
      inferredTargetSlotId !== intent.active_slot_id
    ) {
      violations.push("wrong_slot_target");
    }
  }

  if (inferredTargetSlotId) {
    const inferredSlot = getPreviewSlots(params.state).find((slot) => slot.id === inferredTargetSlotId) ?? null;
    if (inferredSlot && inferredSlot.section !== intent.active_section_id) {
      violations.push("section_drift");
    }
  }

  const foreignSectionMentions = findMentionedForeignSectionIds(params.response, intent.active_section_id);
  if (!intent.can_transition && foreignSectionMentions.length > 0) {
    violations.push("forbidden_slot_reference");
    violations.push("section_drift");
  }

  return {
    valid: violations.length === 0,
    violations: Array.from(new Set(violations)),
    inferred_target_slot_id: inferredTargetSlotId,
  };
}

export async function generateAssistantResponse(params: {
  state: InterviewState;
  userMessage: string;
  nextQuestion: string;
  questionType: QuestionType;
  taskType?: TaskType;
  questionStyle?: QuestionStyle;
  plannerAction?: PlannerAction;
  userFacingProgressNote?: string;
  recentMessages?: InterviewMessage[];
  sectionAdvanced?: boolean;
  currentSectionName?: string;
  workflowState?: InterviewWorkflowState;
  language?: "en" | "zh";
  turnIntent?: TurnIntent;
}): Promise<string> {
  const diagnostics = params.state.system_assessment.last_turn_diagnostics;
  const sectionName = params.currentSectionName ?? getCurrentSectionName(params.state);
  const workflow = params.workflowState ?? params.state.workflow;

  if (params.plannerAction === "handoff") {
    return "We've gathered strong context. This now needs a human strategist for the nuanced parts. I've prepared a handoff summary for them.";
  }

  const taskKey: TaskPromptKey = params.taskType ?? "answer_question";
  const basePrompt = interviewSystemPrompt();
  const taskPrompt = loadTaskPrompt(taskKey);
  const systemPrompt = `${basePrompt}\n\n---\n\n${taskPrompt}`;
  const userPrompt = interviewUserPrompt({
    userMessage: params.userMessage,
    state: params.state,
    nextQuestion: params.nextQuestion,
    questionType: params.questionType,
    taskType: params.taskType ?? "answer_question",
    capturedFieldsThisTurn: diagnostics.captured_fields_this_turn,
    capturedChecklistItemsThisTurn: diagnostics.captured_checklist_items_this_turn,
    recentMessages: params.recentMessages ?? [],
    sectionAdvanced: params.sectionAdvanced ?? false,
    currentSectionName: sectionName,
    workflowPhase: workflow.phase,
    transitionAllowed: workflow.transition_allowed,
    pendingReviewSectionName: sectionNameFromId(workflow.pending_review_section_id),
    language: params.language,
  });

  try {
    const response = await generateModelText({
      system: systemPrompt,
      prompt: userPrompt,
    });

    if (!response || response.trim().length < 10) {
      return minimalFallback({
        nextQuestion: params.nextQuestion,
        capturedFieldsThisTurn: diagnostics.captured_fields_this_turn,
        currentSectionName: sectionName,
        state: params.state,
        language: params.language,
        userFacingProgressNote: params.userFacingProgressNote,
      });
    }
    const cleaned = stripUnauthorizedTransitions(response, workflow.transition_allowed);
    if (cleaned.removed) {
      if (!diagnostics.tool_actions_used.includes("assistant_response_guardrail_transition_strip")) {
        diagnostics.tool_actions_used.push("assistant_response_guardrail_transition_strip");
      }
      if (!workflow.transition_allowed) {
        console.warn(
          "[assistant] Blocked unauthorized section transition phrasing",
          JSON.stringify({
            workflow_phase: workflow.phase,
            pending_review_section_id: workflow.pending_review_section_id,
            active_section_id: workflow.active_section_id,
          }),
        );
      }
    }
    if (!cleaned.text) {
      const fallback = deterministicContractFallback({
        state: params.state,
        turnIntent: params.turnIntent,
        nextQuestion: params.nextQuestion,
        language: params.language,
      });
      params.state.system_assessment.last_contract_validation_result = {
        valid: false,
        violations: ["empty_after_transition_strip"],
        inferred_target_slot_id: null,
        fallback_used: true,
      };
      return fallback;
    }
    const validation = validateAgainstTurnIntent({
      state: params.state,
      response: cleaned.text,
      turnIntent: params.turnIntent,
    });
    if (!validation.valid) {
      const fallback = deterministicContractFallback({
        state: params.state,
        turnIntent: params.turnIntent,
        nextQuestion: params.nextQuestion,
        language: params.language,
      });
      if (!diagnostics.tool_actions_used.includes("assistant_turn_contract_fallback")) {
        diagnostics.tool_actions_used.push("assistant_turn_contract_fallback");
      }
      params.state.system_assessment.last_contract_validation_result = {
        valid: false,
        violations: validation.violations,
        inferred_target_slot_id: validation.inferred_target_slot_id,
        fallback_used: true,
      };
      return fallback;
    }
    params.state.system_assessment.last_contract_validation_result = {
      valid: true,
      violations: [],
      inferred_target_slot_id: validation.inferred_target_slot_id,
      fallback_used: false,
    };
    return cleaned.text;
  } catch {
    params.state.system_assessment.last_contract_validation_result = {
      valid: false,
      violations: ["model_generation_failed"],
      inferred_target_slot_id: null,
      fallback_used: true,
    };
    return minimalFallback({
      nextQuestion: params.nextQuestion,
      capturedFieldsThisTurn: diagnostics.captured_fields_this_turn,
      currentSectionName: sectionName,
      state: params.state,
      language: params.language,
      userFacingProgressNote: params.userFacingProgressNote,
    });
  }
}
