import { z } from "zod";
import {
  AskmoreV2AiThinkingResult,
  AskmoreV2InsightDomain,
  AskmoreV2InsightPackTrace,
  AskmoreV2InsightQualityFlags,
} from "@/server/askmore_v2/types";
import {
  AiThinkingStageAResult,
  AiThinkingStageBDraft1Result,
} from "@/server/askmore_v2/insight/prompt-composer";

const confidenceSchema = z.enum(["low", "medium", "high"]);

// Strict model-call schema (OpenAI JSON-schema mode requires explicit required keys).
const stageBModelSchema = z.object({
  professional_read: z.string().trim().min(1),
  what_i_would_pay_attention_to: z.string().trim().min(1),
  practical_guidance: z.string().trim().min(1),
  boundary_notes: z.array(z.string().trim()),
}).passthrough();

// Relaxed schema for normalization/fallback paths.
const stageBNormalizeSchema = z.object({
  professional_read: z.string().trim().default(""),
  what_i_would_pay_attention_to: z.string().trim().default(""),
  practical_guidance: z.string().trim().default(""),
  boundary_notes: z.array(z.string().trim()).default([]),
}).passthrough();

const stageBDraft1Schema = z.object({
  draft1_professional_read: z.string().trim().min(1),
  draft1_attention_points: z.string().trim().min(1),
  draft1_practical_guidance: z.string().trim().min(1),
  observation_anchors: z.array(z.string().trim()),
  open_questions_or_hypotheses: z.array(z.string().trim()),
  tone_risks_to_avoid_in_draft2: z.array(z.string().trim()),
});

const RESERVED_STAGE_B_KEYS = new Set([
  "professional_read",
  "what_i_would_pay_attention_to",
  "practical_guidance",
  "boundary_notes",
]);

function toAdditionalSections(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_STAGE_B_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function nonEmptyList(values: string[]): string[] {
  return values.map((item) => item.trim()).filter(Boolean);
}

export interface AiThinkingDraft2StyleSignals {
  is_conclusion_first: boolean;
  has_observation_anchor: boolean;
  has_open_question_or_hypothesis: boolean;
  too_template_like: boolean;
  rewrite_needed: boolean;
}

function firstMeaningfulLine(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

function hasObservationAnchor(text: string): boolean {
  return /(我看到|我注意到|你提到|你说到|从你|我听到|你反复提到|I notice|I see|you mentioned|from what you shared|I hear)/i
    .test(text);
}

function hasOpenQuestionOrHypothesis(text: string): boolean {
  return /(有没有可能|我会猜|会不会|我会好奇|你有没有发现|我会怀疑|could it be|I wonder|I'm curious|I am curious|have you noticed|I suspect)/i
    .test(text);
}

export function evaluateAiThinkingDraft2Style(raw: unknown): AiThinkingDraft2StyleSignals {
  const parsed = stageBNormalizeSchema.safeParse(raw);
  const base = parsed.success ? parsed.data : stageBNormalizeSchema.parse({});
  const joined = `${base.professional_read}\n${base.what_i_would_pay_attention_to}\n${base.practical_guidance}`;
  const firstLine = firstMeaningfulLine(base.professional_read);

  const isConclusionFirst = /^(你目前正处于|当前核心问题|这说明|总的判断是|You are currently|The core issue|This means)/i
    .test(firstLine);
  const hasAnchor = hasObservationAnchor(joined);
  const hasOpen = hasOpenQuestionOrHypothesis(joined);
  const tooTemplateLike = /(优先级|执行成本|框架不清晰|需要更多信息|建议持续观察|typical|further assessment|insufficient information)/i
    .test(joined);

  const rewriteScore = (isConclusionFirst ? 2 : 0)
    + (hasAnchor ? 0 : 1)
    + (hasOpen ? 0 : 1)
    + (tooTemplateLike ? 1 : 0);

  return {
    is_conclusion_first: isConclusionFirst,
    has_observation_anchor: hasAnchor,
    has_open_question_or_hypothesis: hasOpen,
    too_template_like: tooTemplateLike,
    rewrite_needed: isConclusionFirst || rewriteScore >= 2,
  };
}

export function buildAiThinkingQualityFlags(
  result: AskmoreV2AiThinkingResult,
  styleSignals?: AiThinkingDraft2StyleSignals,
): AskmoreV2InsightQualityFlags {
  const compactLength = (
    result.professional_read
    + result.what_i_would_pay_attention_to
    + result.practical_guidance
  ).replace(/\s+/g, "").length;

  const hasProfessionalRead = result.professional_read.trim().length > 0;
  const hasAttentionPoints = result.what_i_would_pay_attention_to.trim().length > 0;
  const hasPracticalGuidance = result.practical_guidance.trim().length > 0;
  const tooShort = compactLength < 80;
  const boilerplateSignal = /(优先级|执行成本|框架不清晰|需要更多信息|insufficient|priority|execution cost)/i
    .test(`${result.professional_read}\n${result.what_i_would_pay_attention_to}\n${result.practical_guidance}`);
  const style = styleSignals ?? evaluateAiThinkingDraft2Style({
    professional_read: result.professional_read,
    what_i_would_pay_attention_to: result.what_i_would_pay_attention_to,
    practical_guidance: result.practical_guidance,
  });

  return {
    has_professional_read: hasProfessionalRead,
    has_attention_points: hasAttentionPoints,
    has_practical_guidance: hasPracticalGuidance,
    prompt_configured: true,
    too_generic: !hasProfessionalRead || !hasAttentionPoints || !hasPracticalGuidance || tooShort || boilerplateSignal || style.too_template_like,
    is_conclusion_first: style.is_conclusion_first,
    has_observation_anchor: style.has_observation_anchor,
    has_open_question_or_hypothesis: style.has_open_question_or_hypothesis,
    too_template_like: style.too_template_like,
  };
}

export function normalizeAiThinkingResult(params: {
  raw: unknown;
  stageA: AiThinkingStageAResult;
  domain: AskmoreV2InsightDomain;
  packTrace: AskmoreV2InsightPackTrace;
  promptComposition?: string[];
  styleSignals?: AiThinkingDraft2StyleSignals;
}): AskmoreV2AiThinkingResult {
  const parsed = stageBNormalizeSchema.safeParse(params.raw);
  const base = parsed.success ? parsed.data : stageBNormalizeSchema.parse({});
  const additionalSections = toAdditionalSections(base as Record<string, unknown>);

  const normalized: AskmoreV2AiThinkingResult = {
    version: "ai_thinking.v2",
    domain: params.domain,
    professional_read: base.professional_read,
    what_i_would_pay_attention_to: base.what_i_would_pay_attention_to,
    practical_guidance: base.practical_guidance,
    additional_sections: Object.keys(additionalSections).length > 0 ? additionalSections : undefined,
    stage_a_read: {
      provider_intent_read: params.stageA.provider_intent_read.trim(),
      respondent_state_read: params.stageA.respondent_state_read.trim(),
      expert_impression: params.stageA.expert_impression.trim(),
    },
    underlying_drivers_evidence: params.stageA.underlying_drivers_evidence.map((item) => ({
      hypothesis: item.hypothesis.trim(),
      support: nonEmptyList(item.support),
      confidence: item.confidence,
    })),
    internal_reasoning_map: {
      observed_facts: nonEmptyList(params.stageA.observed_facts),
      signals: nonEmptyList(params.stageA.signals),
      claims: nonEmptyList(params.stageA.claims),
      unsupported_speculations: nonEmptyList(params.stageA.unsupported_speculations),
    },
    boundary_notes: nonEmptyList([
      ...params.stageA.boundary_notes,
      ...base.boundary_notes,
    ]),
    prompt_composition: params.promptComposition ?? [],
    pack_trace: params.packTrace,
    quality_flags: {
      has_professional_read: false,
      has_attention_points: false,
      has_practical_guidance: false,
      prompt_configured: true,
      too_generic: true,
    },
  };

  normalized.quality_flags = buildAiThinkingQualityFlags(normalized, params.styleSignals);
  return normalized;
}

export const aiThinkingStageASchema = z.object({
  provider_intent_read: z.string().trim().min(1),
  respondent_state_read: z.string().trim().min(1),
  expert_impression: z.string().trim().min(1),
  observed_facts: z.array(z.string().trim()),
  signals: z.array(z.string().trim()),
  claims: z.array(z.string().trim()),
  unsupported_speculations: z.array(z.string().trim()),
  underlying_drivers_evidence: z.array(z.object({
    hypothesis: z.string().trim().min(1),
    support: z.array(z.string().trim()),
    confidence: confidenceSchema,
  })),
  boundary_notes: z.array(z.string().trim()),
});

export const aiThinkingStageBDraft1Schema = stageBDraft1Schema;
export const aiThinkingStageBSchema = stageBModelSchema;
export type AiThinkingStageBDraft1SchemaResult = AiThinkingStageBDraft1Result;
