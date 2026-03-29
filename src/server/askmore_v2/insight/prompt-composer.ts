import { askmoreV2AiThinkingPromptAssets } from "@/server/askmore_v2/prompts";
import { getInsightPack } from "@/server/askmore_v2/insight/pack-registry";
import { InsightContextPayload } from "@/server/askmore_v2/insight/context-builder";
import { AskmoreV2InsightPackTrace } from "@/server/askmore_v2/types";

export class AiThinkingPromptNotConfiguredError extends Error {
  code = "prompt_not_configured";
  constructor(public readonly field: string) {
    super(`AI Thinking prompt is not configured: ${field}`);
    this.name = "AiThinkingPromptNotConfiguredError";
  }
}

export interface AiThinkingStageAResult {
  provider_intent_read: string;
  respondent_state_read: string;
  expert_impression: string;
  observed_facts: string[];
  signals: string[];
  claims: string[];
  unsupported_speculations: string[];
  underlying_drivers_evidence: Array<{
    hypothesis: string;
    support: string[];
    confidence: "low" | "medium" | "high";
  }>;
  boundary_notes: string[];
}

export interface AiThinkingStageBDraft1Result {
  draft1_professional_read: string;
  draft1_attention_points: string;
  draft1_practical_guidance: string;
  observation_anchors: string[];
  open_questions_or_hypotheses: string[];
  tone_risks_to_avoid_in_draft2: string[];
  provider_intent_by_question: string[];
  respondent_line_by_line_read: string[];
  hypothesis_space: {
    conservative: string[];
    balanced: string[];
    aggressive: string[];
  };
  candidate_pool: {
    reminders: string[];
    missing_checks: string[];
    practical_options: string[];
    reassurance_lines: string[];
  };
}

const STAGE_A_PROMPT = [
  "Stage A: internal professional read only.",
  "Read what provider intended to learn from the question design.",
  "Read respondent state, pressure pattern, and communication style from answers.",
  "Build an expert internal impression with evidence and confidence calibration.",
  "Output strictly with the Stage A schema.",
].join("\n");

const STAGE_B_DRAFT1_PROMPT_FRAME = [
  "Stage B Draft1: full exploration draft for AI Thinking v2.1.",
  "Follow stage_b_explore_v2 as the primary guide.",
  "Write comprehensive internal exploration with observation -> empathy -> hypothesis -> reflective questions.",
  "Draft1 must expand possibility space: include conservative, balanced, and aggressive interpretations where relevant.",
  "Draft1 must read provider intent per major question and connect it to respondent signals explicitly.",
  "Draft1 should be materially richer than final Draft2 (typically longer and broader).",
  "Do not output final concise report tone in this draft.",
  "Output strictly with the Stage B Draft1 schema only.",
].join("\n");

const STAGE_B_DRAFT2_PROMPT_FRAME = [
  "Stage B Draft2: final visible writing for AI Thinking v2.1.",
  "Follow stage_b_write_v2 as the primary writing guide.",
  "Use Stage B Draft1 as source material; preserve facts and evidence.",
  "Write as a one-to-one professional conversation, not a report.",
  "First hold owner emotion, then explain condition clearly, then converge to practical direction.",
  "Do not write checklist-style report language.",
  "Do not output generic process advice.",
  "Draft2 must NOT mirror Draft1 sentence order or paragraph structure.",
  "Draft2 should converge from Draft1: keep strongest insights, remove noise, and re-express in cleaner language.",
  "Do not start with labels like '你目前正处于一个典型的...'.",
  "Each section must include observation anchors and at least one open question/hypothesis phrasing.",
  "Markdown requirement (MUST): visible sections should use readable markdown structure.",
  "Use at least one markdown emphasis (e.g. **bold**).",
  "When presenting 2 or more points, prefer markdown bullets for readability.",
  "Highlight one key phrase in each section when useful.",
  "Output strictly with the Stage B schema only.",
].join("\n");

const STAGE_B_DRAFT2_REWRITE_PROMPT_FRAME = [
  "Rewrite pass for Stage B Draft2.",
  "Do NOT change facts, evidence, or case direction.",
  "Improve only expression quality to avoid conclusion-first, template tone, or rigid report voice.",
  "Increase co-thinking flow: observation -> empathy -> hypothesis -> reflective question -> practical suggestion.",
  "Keep language natural, non-judgmental, and case-specific.",
].join("\n");

const PET_REASSURANCE_HARD_GUARD = [
  "Pet-domain hard requirement (MUST):",
  "- In each visible section, include one dedicated reassurance paragraph.",
  "- Reassurance paragraph must feel natural in conversation; do not force fixed label templates.",
  "- Reassurance must be evidence-based and paired with clear observation/escalation thresholds.",
  "- Do not use empty comfort language.",
].join("\n");

const OUTPUT_CONSTRAINT_PROMPT = [
  "Return valid JSON only.",
  "Never include chain-of-thought.",
  "If evidence is sparse, still provide best-effort insight and clearly calibrated confidence.",
].join("\n");

export type AiThinkingOutputLanguage = "zh" | "en";

function nonEmptyPrompt(name: string, value: string): string {
  if (!value.trim()) throw new AiThinkingPromptNotConfiguredError(name);
  return value;
}

function packInstructions(packIds: string[]): string {
  return packIds
    .map((packId) => {
      const pack = getInsightPack(packId);
      const rules = pack.instructions.map((line) => `- ${line}`).join("\n");
      return [`[${pack.type}] ${pack.id}`, rules].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function domainPromptKey(domainPack: string): keyof ReturnType<typeof askmoreV2AiThinkingPromptAssets> {
  if (domainPack === "business.general.v2") return "business_general_v2";
  if (domainPack === "mental_health.intake.v2") return "mental_health_intake_v2";
  if (domainPack === "pet_clinic.general.v2") return "pet_clinic_general_v2";
  throw new Error(`Unknown v2 domain prompt mapping for pack: ${domainPack}`);
}

function normalizeToText(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => normalizeToText(item)).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map((item) => normalizeToText(item)).join(" ");
  return "";
}

function collectContextText(context: InsightContextPayload): string {
  return [
    context.user_goal,
    context.metadata.scenario,
    context.metadata.target_output_type,
    ...context.conversation_history.map((item) => item.content),
    ...context.question_sheet.flatMap((item) => [item.original_question, item.entry_question, ...item.sub_questions]),
    ...Object.values(context.structured_answers).map((value) => normalizeToText(value)),
  ].join("\n");
}

function countChineseChars(text: string): number {
  const matches = text.match(/[\u4E00-\u9FFF]/g);
  return matches ? matches.length : 0;
}

function countEnglishWords(text: string): number {
  const matches = text.match(/[A-Za-z]+/g);
  return matches ? matches.length : 0;
}

function contextLanguageSignal(context: InsightContextPayload): {
  zh_char_count: number;
  en_word_count: number;
  metadata_language: string;
} {
  const text = collectContextText(context);
  return {
    zh_char_count: countChineseChars(text),
    en_word_count: countEnglishWords(text),
    metadata_language: context.metadata.language,
  };
}

export function resolveAiThinkingOutputLanguage(context: InsightContextPayload): AiThinkingOutputLanguage {
  const text = collectContextText(context);
  const zhCount = countChineseChars(text);
  const enWordCount = countEnglishWords(text);

  if (zhCount >= 24 && zhCount >= enWordCount) return "zh";
  if (enWordCount >= 24 && enWordCount > zhCount * 2) return "en";

  return context.metadata.language === "zh" ? "zh" : "en";
}

function outputLanguageInstruction(language: AiThinkingOutputLanguage): string {
  if (language === "zh") {
    return [
      "Output language requirement (MUST):",
      "- Write all visible output fields in Simplified Chinese.",
      "- Keep field names/schema unchanged; only field content should be Chinese.",
      "- Do not switch to English unless quoting user-provided English text.",
    ].join("\n");
  }
  return [
    "Output language requirement (MUST):",
    "- Write all visible output fields in English.",
    "- Keep field names/schema unchanged; only field content should be English.",
    "- Do not switch to Chinese unless quoting user-provided Chinese text.",
  ].join("\n");
}

function languageVarsBlock(params: {
  language: AiThinkingOutputLanguage;
  instruction: string;
  signal: {
    zh_char_count: number;
    en_word_count: number;
    metadata_language: string;
  };
}): string {
  return `Language Variables JSON:\n${JSON.stringify({
    target_output_language: params.language,
    language_instruction: params.instruction,
    context_language_signal: params.signal,
  })}`;
}

function resolvePromptParts(params: {
  packTrace: AskmoreV2InsightPackTrace;
  context: InsightContextPayload;
}) {
  const packOrder = [
    params.packTrace.core_pack,
    params.packTrace.domain_pack,
    ...params.packTrace.subdomain_packs,
    params.packTrace.style_pack,
    params.packTrace.safety_pack,
  ];
  const assets = askmoreV2AiThinkingPromptAssets();
  const promptRevision = assets.prompt_revision || "unknown";
  const systemBase = nonEmptyPrompt("system_base_prompt_v2", assets.system_base_prompt_v2);
  const domainPrompt = nonEmptyPrompt(
    domainPromptKey(params.packTrace.domain_pack),
    assets[domainPromptKey(params.packTrace.domain_pack)],
  );
  const outputLanguage = resolveAiThinkingOutputLanguage(params.context);
  const languageInstruction = outputLanguageInstruction(outputLanguage);
  const languageSignal = contextLanguageSignal(params.context);
  return {
    assets,
    packOrder,
    systemBase,
    domainPrompt,
    promptRevision,
    outputLanguage,
    languageInstruction,
    languageSignal,
  };
}

export function composeAiThinkingStageAPrompt(params: {
  packTrace: AskmoreV2InsightPackTrace;
  context: InsightContextPayload;
}): {
  system: string;
  prompt: string;
  promptComposition: string[];
} {
  const {
    packOrder,
    systemBase,
    domainPrompt,
    promptRevision,
    outputLanguage,
    languageInstruction,
    languageSignal,
  } = resolvePromptParts(params);

  const prompt = [
    STAGE_A_PROMPT,
    languageVarsBlock({
      language: outputLanguage,
      instruction: languageInstruction,
      signal: languageSignal,
    }),
    domainPrompt,
    packInstructions(packOrder),
    OUTPUT_CONSTRAINT_PROMPT,
    `Runtime Context JSON:\n${JSON.stringify(params.context)}`,
  ].join("\n\n");

  return {
    system: systemBase,
    prompt,
    promptComposition: [
      "stage_a",
      `prompt_revision:${promptRevision}`,
      "system_base_prompt_v2",
      `domain_prompt:${params.packTrace.domain_pack}`,
      `resolved_packs:${packOrder.join(",")}`,
      `output_language:${outputLanguage}`,
      "language_instruction",
      "context_language_signal",
      "runtime_context_payload",
    ],
  };
}

export function composeAiThinkingStageBDraft1Prompt(params: {
  packTrace: AskmoreV2InsightPackTrace;
  context: InsightContextPayload;
  stageAResult: AiThinkingStageAResult;
}): {
  system: string;
  prompt: string;
  promptComposition: string[];
} {
  const {
    assets,
    packOrder,
    systemBase,
    domainPrompt,
    promptRevision,
    outputLanguage,
    languageInstruction,
    languageSignal,
  } = resolvePromptParts(params);
  const stageBExplorePrompt = nonEmptyPrompt("stage_b_explore_v2", assets.stage_b_explore_v2);

  const prompt = [
    STAGE_B_DRAFT1_PROMPT_FRAME,
    "stage_b_explore_v2:",
    stageBExplorePrompt,
    languageVarsBlock({
      language: outputLanguage,
      instruction: languageInstruction,
      signal: languageSignal,
    }),
    domainPrompt,
    packInstructions(packOrder),
    OUTPUT_CONSTRAINT_PROMPT,
    `Stage A Internal Read JSON:\n${JSON.stringify(params.stageAResult)}`,
    `Runtime Context JSON:\n${JSON.stringify(params.context)}`,
    [
      "Stage B Draft1 output schema:",
      "{",
      '  "draft1_professional_read": "string",',
      '  "draft1_attention_points": "string",',
      '  "draft1_practical_guidance": "string",',
      '  "observation_anchors": ["string"],',
      '  "open_questions_or_hypotheses": ["string"],',
      '  "tone_risks_to_avoid_in_draft2": ["string"],',
      '  "provider_intent_by_question": ["string"],',
      '  "respondent_line_by_line_read": ["string"],',
      '  "hypothesis_space": {',
      '    "conservative": ["string"],',
      '    "balanced": ["string"],',
      '    "aggressive": ["string"]',
      "  },",
      '  "candidate_pool": {',
      '    "reminders": ["string"],',
      '    "missing_checks": ["string"],',
      '    "practical_options": ["string"],',
      '    "reassurance_lines": ["string"]',
      "  }",
      "}",
    ].join("\n"),
  ].join("\n\n");

  return {
    system: systemBase,
    prompt,
    promptComposition: [
      "stage_b_draft1",
      `prompt_revision:${promptRevision}`,
      "stage_b_explore",
      "system_base_prompt_v2",
      `domain_prompt:${params.packTrace.domain_pack}`,
      `resolved_packs:${packOrder.join(",")}`,
      `output_language:${outputLanguage}`,
      "language_instruction",
      "context_language_signal",
      "stage_a_output",
      "runtime_context_payload",
    ],
  };
}

export function composeAiThinkingStageBDraft2Prompt(params: {
  packTrace: AskmoreV2InsightPackTrace;
  context: InsightContextPayload;
  stageAResult: AiThinkingStageAResult;
  stageBDraft1Result: AiThinkingStageBDraft1Result;
  previousDraft2Result?: unknown;
  rewriteReasons?: string[];
}): {
  system: string;
  prompt: string;
  promptComposition: string[];
} {
  const {
    assets,
    packOrder,
    systemBase,
    domainPrompt,
    promptRevision,
    outputLanguage,
    languageInstruction,
    languageSignal,
  } = resolvePromptParts(params);
  const stageBWritePrompt = nonEmptyPrompt("stage_b_write_v2", assets.stage_b_write_v2);

  const promptParts: string[] = [
    STAGE_B_DRAFT2_PROMPT_FRAME,
    "stage_b_write_v2:",
    stageBWritePrompt,
    languageVarsBlock({
      language: outputLanguage,
      instruction: languageInstruction,
      signal: languageSignal,
    }),
    domainPrompt,
    packInstructions(packOrder),
    OUTPUT_CONSTRAINT_PROMPT,
    `Stage A Internal Read JSON:\n${JSON.stringify(params.stageAResult)}`,
    `Stage B Draft1 JSON:\n${JSON.stringify(params.stageBDraft1Result)}`,
    `Runtime Context JSON:\n${JSON.stringify(params.context)}`,
    [
      "Stage B output schema:",
      "{",
      '  "professional_read": "string",',
      '  "what_i_would_pay_attention_to": "string",',
      '  "practical_guidance": "string",',
      '  "boundary_notes": ["string"]',
      "}",
    ].join("\n"),
  ];

  const promptComposition: string[] = [
    "stage_b_draft2",
    `prompt_revision:${promptRevision}`,
    "stage_b_write",
    "system_base_prompt_v2",
    `domain_prompt:${params.packTrace.domain_pack}`,
    `resolved_packs:${packOrder.join(",")}`,
    `output_language:${outputLanguage}`,
    "language_instruction",
    "context_language_signal",
    "stage_a_output",
    "stage_b_draft1_output",
    "runtime_context_payload",
  ];

  if (params.previousDraft2Result || (params.rewriteReasons && params.rewriteReasons.length > 0)) {
    promptParts.push(STAGE_B_DRAFT2_REWRITE_PROMPT_FRAME);
    if (params.rewriteReasons?.length) {
      promptParts.push(`Rewrite reasons:\n${JSON.stringify(params.rewriteReasons)}`);
    }
    if (params.previousDraft2Result) {
      promptParts.push(`Previous Stage B Draft2 JSON:\n${JSON.stringify(params.previousDraft2Result)}`);
    }
    promptComposition.push("stage_b_draft2_retry");
  }

  if (params.context.domain === "pet_clinic") {
    promptParts.push(PET_REASSURANCE_HARD_GUARD);
    promptComposition.push("pet_owner_reassurance_guard");
  }

  return {
    system: systemBase,
    prompt: promptParts.join("\n\n"),
    promptComposition,
  };
}

export function composeAiThinkingStageBPrompt(params: {
  packTrace: AskmoreV2InsightPackTrace;
  context: InsightContextPayload;
  stageAResult: AiThinkingStageAResult;
}): {
  system: string;
  prompt: string;
  promptComposition: string[];
} {
  return composeAiThinkingStageBDraft2Prompt({
    packTrace: params.packTrace,
    context: params.context,
    stageAResult: params.stageAResult,
    stageBDraft1Result: {
      draft1_professional_read: params.stageAResult.expert_impression,
      draft1_attention_points: params.stageAResult.respondent_state_read,
      draft1_practical_guidance: params.stageAResult.provider_intent_read,
      observation_anchors: params.stageAResult.observed_facts,
      open_questions_or_hypotheses: params.stageAResult.claims,
      tone_risks_to_avoid_in_draft2: [],
      provider_intent_by_question: [],
      respondent_line_by_line_read: [],
      hypothesis_space: {
        conservative: [],
        balanced: [],
        aggressive: [],
      },
      candidate_pool: {
        reminders: [],
        missing_checks: [],
        practical_options: [],
        reassurance_lines: [],
      },
    },
  });
}
