import {
  ContractValidationResult,
  ExtractionOutput,
  InterviewState,
  NextStep,
  PreviewSlot,
  ResponseMode,
  TurnIntent,
} from "@/lib/types";
import { generateModelText } from "@/server/model/adapters";
import { getPreviewSlots, PREVIEW_SECTION_ORDER } from "@/server/services/preview-slots";

interface ComposerInput {
  mode: ResponseMode;
  target_slot_id: string | null;
  target_question_label: string | null;
  target_summary_hint: string | null;
  updated_fields: string[];
  extraction_contract_summary: ExtractionOutput | null;
  preferred_tone: string[];
  preferred_voice: string[];
  preferred_style_tags: string[];
  language: "en" | "zh";
}

const FIELD_LABELS: Record<string, string> = {
  "company_profile.company_one_liner": "company summary",
  "brand_story.core_belief": "brand belief",
  "brand_story.what_should_people_remember": "memorable takeaway",
  "product_service.primary_offering": "main offering",
  "product_service.problem_solved": "problem solved",
  "product_service.key_differentiators": "differentiator",
  "market_audience.primary_audience": "primary audience",
  "market_audience.audience_pain_points": "audience pain points",
  "market_audience.audience_desired_outcomes": "desired outcomes",
  "market_audience.attraction_goal": "LinkedIn attraction goal",
};

const SLOT_ALIASES: Record<string, string[]> = {
  "company_understanding.company_summary": ["company does", "一句话概括", "公司到底做什么"],
  "company_understanding.brand_story": ["core belief", "remember most", "品牌信念", "记住你们什么"],
  "company_understanding.main_offering": ["product or service", "main offering", "核心产品", "核心服务"],
  "company_understanding.problem_solved": ["problem solve", "解决客户的什么问题", "什么问题"],
  "company_understanding.differentiator": ["different from alternatives", "最不一样", "差异化", "区别在于"],
  "audience_understanding.primary_audience": ["primary audience", "target audience", "目标受众", "哪类受众"],
  "audience_understanding.core_problems": ["struggle with today", "痛点", "问题"],
  "audience_understanding.desired_outcomes": ["desired outcomes", "想获得的结果", "结果"],
  "audience_understanding.linkedin_attraction_goal": ["attract on linkedin", "吸引哪类人"],
};

function humanizeUpdatedFields(fields: string[]): string {
  const labels = fields.map((field) => FIELD_LABELS[field] ?? field.split(".").pop() ?? field);
  return labels.slice(0, 3).join(", ");
}

function buildStyleHint(input: ComposerInput): string {
  const hints = [
    ...input.preferred_tone,
    ...input.preferred_voice,
    ...input.preferred_style_tags,
  ].filter(Boolean);
  return hints.length > 0 ? hints.slice(0, 5).join(", ") : "warm, strategic, concise";
}

function buildSystemPrompt(language: "en" | "zh"): string {
  if (language === "zh") {
    return [
      "你是一位资深 LinkedIn 内容策略顾问。",
      "你不是在决定流程，只是在为后端已决定的下一步写一句自然、专业、简洁的回复。",
      "严格遵守给定的 response mode 和 target slot。",
      "只能问一个问题。",
      "不要提及字段名、section 名、系统内部逻辑。",
    ].join(" ");
  }
  return [
    "You are a senior LinkedIn content strategist.",
    "You are not deciding workflow; you are phrasing the backend-selected next move.",
    "Strictly follow the given response mode and target slot.",
    "Ask only one question.",
    "Do not mention internal fields, section names, or workflow machinery.",
  ].join(" ");
}

function buildUserPrompt(input: ComposerInput): string {
  const changed = input.updated_fields.length > 0
    ? `Updated this turn: ${humanizeUpdatedFields(input.updated_fields)}`
    : "No new field was captured this turn; respond based on confirmation state or the current target.";

  return [
    `Response mode: ${input.mode}`,
    `Target slot id: ${input.target_slot_id ?? "none"}`,
    `Target question: ${input.target_question_label ?? "none"}`,
    `Current slot summary hint: ${input.target_summary_hint ?? "none"}`,
    `Style hint from user preferences: ${buildStyleHint(input)}`,
    changed,
    input.extraction_contract_summary
      ? `Extraction reason: ${input.extraction_contract_summary.reason}`
      : "",
    input.language === "zh"
      ? "请用简体中文回复。先简短承接，再做后端要求的下一步。"
      : "Respond in English. Briefly acknowledge, then do the backend-required next step.",
    input.mode === "ask_active_slot"
      ? "Ask exactly one focused question for the target slot."
      : input.mode === "confirm_active_slot"
        ? "Summarize the target slot in one concise sentence, then ask if that summary is accurate."
        : "Ask the user to confirm or edit the completed section only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function getSlotById(state: InterviewState, slotId: string | null): PreviewSlot | null {
  if (!slotId) return null;
  return getPreviewSlots(state).find((slot) => slot.id === slotId) ?? null;
}

function extractQuestionCount(text: string): number {
  return (text.match(/[?？]/g) ?? []).length;
}

function inferTargetSlotId(state: InterviewState, text: string): string | null {
  const normalized = text.toLowerCase();
  let best: { id: string | null; score: number } = { id: null, score: 0 };

  for (const slot of getPreviewSlots(state)) {
    let score = 0;
    const normalizedLabel = slot.question_label.toLowerCase().replace(/[?？]/g, "");
    if (normalizedLabel && normalized.includes(normalizedLabel)) score += 4;
    for (const alias of SLOT_ALIASES[slot.id] ?? []) {
      if (normalized.includes(alias.toLowerCase())) score += 3;
    }
    if (score > best.score) best = { id: slot.id, score };
  }

  return best.score >= 3 ? best.id : null;
}

function deterministicFallback(input: ComposerInput): string {
  const styleHint = buildStyleHint(input);
  const strategicLead = input.language === "zh"
    ? styleHint.includes("analytical") || styleHint.includes("分析")
      ? "我先把关键判断收束一下。"
      : "我先把重点整理一下。"
    : styleHint.includes("analytical")
      ? "Let me tighten the signal first."
      : "Let me capture the key point first.";

  if (input.mode === "confirm_section") {
    return input.language === "zh"
      ? `${strategicLead} 这一部分我已经整理好了。请确认是否准确，或者直接告诉我需要修改的地方。`
      : `${strategicLead} I have this section organized. Please confirm it is accurate or tell me what to adjust.`;
  }

  if (input.mode === "confirm_active_slot") {
    const summary = input.target_summary_hint || (input.language === "zh" ? "当前这个关键点" : "this key point");
    return input.language === "zh"
      ? `${strategicLead} 我先这样概括：${summary}。这样理解准确吗？`
      : `${strategicLead} Here is my current read: ${summary}. Is that accurate?`;
  }

  const question = input.target_question_label ?? (input.language === "zh" ? "请补充当前这个问题的关键信息。" : "Could you fill in this key point?");
  return input.language === "zh"
    ? `${strategicLead} 接下来我想确认一个关键点：${question}`
    : `${strategicLead} Next I want to pin down one key point: ${question}`;
}

function validateComposedAnswer(params: {
  state: InterviewState;
  input: ComposerInput;
  response: string;
}): ContractValidationResult {
  const questionCount = extractQuestionCount(params.response);
  const inferredTarget = inferTargetSlotId(params.state, params.response);
  const violations: string[] = [];

  if (params.input.mode === "ask_active_slot") {
    if (questionCount === 0) violations.push("no_question_in_ask_mode");
    if (questionCount > 1) violations.push("multiple_questions");
    if (inferredTarget && params.input.target_slot_id && inferredTarget !== params.input.target_slot_id) {
      violations.push("wrong_slot_target");
    }
  }

  if (params.input.mode === "confirm_active_slot") {
    if (!/(准确|确认|correct|accurate|confirm)/i.test(params.response)) {
      violations.push("confirm_mode_violation");
    }
    if (questionCount > 1) violations.push("multiple_questions");
  }

  if (params.input.mode === "confirm_section") {
    if (!/(确认|修改|confirm|adjust|edit)/i.test(params.response)) {
      violations.push("confirm_mode_violation");
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    inferred_target_slot_id: inferredTarget,
    fallback_used: false,
  };
}

export async function composeAnswerTurnResponse(params: {
  state: InterviewState;
  nextStep: NextStep;
  extractionContractSummary: ExtractionOutput | null;
  updatedFields: string[];
  language?: "en" | "zh";
  turnIntent?: TurnIntent;
}): Promise<string> {
  const language = params.language ?? "en";
  const slot = getSlotById(params.state, params.nextStep.target_slot_id);
  const input: ComposerInput = {
    mode: params.nextStep.response_mode,
    target_slot_id: params.nextStep.target_slot_id,
    target_question_label:
      params.nextStep.response_mode === "confirm_section"
        ? language === "zh"
          ? "请确认当前板块是否准确，或者告诉我需要修改的地方。"
          : "Please confirm the current section or tell me what to adjust."
        : slot?.question_label ?? null,
    target_summary_hint:
      params.nextStep.response_mode === "confirm_active_slot"
        ? Array.isArray(slot?.display_value)
          ? slot?.display_value.join("; ")
          : (slot?.display_value as string | undefined) ?? null
        : null,
    updated_fields: params.updatedFields,
    extraction_contract_summary: params.extractionContractSummary,
    preferred_tone: params.state.content_preferences.preferred_tone.value,
    preferred_voice: params.state.content_preferences.preferred_voice.value,
    preferred_style_tags: params.state.content_preferences.preferred_style_tags.value,
    language,
  };

  try {
    const response = await generateModelText({
      system: buildSystemPrompt(language),
      prompt: buildUserPrompt(input),
    });

    const validation = validateComposedAnswer({
      state: params.state,
      input,
      response,
    });
    if (!validation.valid || !response.trim()) {
      const fallback = deterministicFallback(input);
      params.state.system_assessment.last_contract_validation_result = {
        ...validation,
        fallback_used: true,
      };
      return fallback;
    }
    params.state.system_assessment.last_contract_validation_result = validation;
    return response.trim();
  } catch {
    const fallback = deterministicFallback(input);
    params.state.system_assessment.last_contract_validation_result = {
      valid: false,
      violations: ["model_generation_failed"],
      inferred_target_slot_id: null,
      fallback_used: true,
    };
    return fallback;
  }
}

export function sectionNameFromId(sectionId: string | null | undefined): string {
  if (!sectionId) return "Current section";
  return PREVIEW_SECTION_ORDER.find((section) => section.id === sectionId)?.name ?? "Current section";
}
