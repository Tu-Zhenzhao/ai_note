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
  provider_intent_by_question: z.array(z.string().trim()),
  respondent_line_by_line_read: z.array(z.string().trim()),
  hypothesis_space: z.object({
    conservative: z.array(z.string().trim()),
    balanced: z.array(z.string().trim()),
    aggressive: z.array(z.string().trim()),
  }),
  candidate_pool: z.object({
    reminders: z.array(z.string().trim()),
    missing_checks: z.array(z.string().trim()),
    practical_options: z.array(z.string().trim()),
    reassurance_lines: z.array(z.string().trim()),
  }),
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
  near_duplicate_with_draft1?: boolean;
  has_reassurance_in_professional_read?: boolean;
  has_reassurance_in_attention_points?: boolean;
  has_reassurance_in_practical_guidance?: boolean;
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

function normalizeSimilarityText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`>#~[\](){},.!?:;"'，。！？：；、“”‘’（）【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toShingles(text: string, size = 3): Set<string> {
  const normalized = normalizeSimilarityText(text).replace(/\s+/g, "");
  const out = new Set<string>();
  if (!normalized) return out;
  if (normalized.length <= size) {
    out.add(normalized);
    return out;
  }
  for (let i = 0; i <= normalized.length - size; i += 1) {
    out.add(normalized.slice(i, i + size));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const item of a) {
    if (b.has(item)) inter += 1;
  }
  const union = a.size + b.size - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function isNearDuplicateWithDraft1(params: {
  draft2: {
    professional_read: string;
    what_i_would_pay_attention_to: string;
    practical_guidance: string;
  };
  draft1: AiThinkingStageBDraft1Result;
}): boolean {
  const pairs: Array<[string, string]> = [
    [params.draft2.professional_read, params.draft1.draft1_professional_read],
    [params.draft2.what_i_would_pay_attention_to, params.draft1.draft1_attention_points],
    [params.draft2.practical_guidance, params.draft1.draft1_practical_guidance],
  ];
  const sims = pairs.map(([left, right]) => jaccard(toShingles(left), toShingles(right)));
  const max = Math.max(...sims);
  const avg = sims.reduce((sum, n) => sum + n, 0) / sims.length;
  return max >= 0.83 || avg >= 0.74;
}

function hasDedicatedReassureParagraph(text: string): boolean {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  return paragraphs.some((p) => /^(安心提示|Reassurance)\s*[:：]/i.test(p));
}

function evaluatePetReassurance(raw: {
  professional_read: string;
  what_i_would_pay_attention_to: string;
  practical_guidance: string;
}): {
  professional: boolean;
  attention: boolean;
  guidance: boolean;
} {
  const positiveSignal = /(积极信号|好信号|相对积极|先不用过度担心|从目前信息看|目前看.*(稳定|可控)|good sign|encouraging sign|reassuring sign|currently stable)/i;
  const cautionSignal = /(需要留意|仍要留意|但.*需要|如果出现|一旦.*(请|需)|worsen|if .*?(appear|happens).*?(vet|clinic)|seek.*(vet|clinic)|prompt clinic escalation)/i;
  const observationSignal = /(观察|记录|留意|变化|频率|尿团|食欲|精神|watch|monitor|track|trend|appetite|energy|today|this week)/i;
  const ladderSignal = /(即刻|现在|今天|24小时|一旦|如果出现|立即就医|马上就医|now|next 24h|same day|escalation|urgent)/i;
  const supportiveSignal = /(你已经做对|你做对了|先别太慌|先不用过度担心|可以一步一步|you're already doing|you did the right thing|try not to panic|one step at a time)/i;

  const professional = hasDedicatedReassureParagraph(raw.professional_read)
    || (positiveSignal.test(raw.professional_read) && cautionSignal.test(raw.professional_read));
  const attention = hasDedicatedReassureParagraph(raw.what_i_would_pay_attention_to)
    || (observationSignal.test(raw.what_i_would_pay_attention_to) && supportiveSignal.test(raw.what_i_would_pay_attention_to));
  const guidance = hasDedicatedReassureParagraph(raw.practical_guidance)
    || (ladderSignal.test(raw.practical_guidance) && supportiveSignal.test(raw.practical_guidance));

  return {
    professional,
    attention,
    guidance,
  };
}

export function evaluateAiThinkingDraft2Style(
  raw: unknown,
  options?: {
    domain?: AskmoreV2InsightDomain;
    draft1?: AiThinkingStageBDraft1Result;
  },
): AiThinkingDraft2StyleSignals {
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

  const nearDuplicateWithDraft1 = options?.draft1
    ? isNearDuplicateWithDraft1({
      draft2: {
        professional_read: base.professional_read,
        what_i_would_pay_attention_to: base.what_i_would_pay_attention_to,
        practical_guidance: base.practical_guidance,
      },
      draft1: options.draft1,
    })
    : false;

  const petSignals = options?.domain === "pet_clinic"
    ? evaluatePetReassurance({
      professional_read: base.professional_read,
      what_i_would_pay_attention_to: base.what_i_would_pay_attention_to,
      practical_guidance: base.practical_guidance,
    })
    : {
      professional: true,
      attention: true,
      guidance: true,
    };
  const petReassuranceMissing = options?.domain === "pet_clinic"
    && (!petSignals.professional || !petSignals.attention || !petSignals.guidance);

  return {
    is_conclusion_first: isConclusionFirst,
    has_observation_anchor: hasAnchor,
    has_open_question_or_hypothesis: hasOpen,
    too_template_like: tooTemplateLike,
    near_duplicate_with_draft1: nearDuplicateWithDraft1 || undefined,
    has_reassurance_in_professional_read: options?.domain === "pet_clinic" ? petSignals.professional : undefined,
    has_reassurance_in_attention_points: options?.domain === "pet_clinic" ? petSignals.attention : undefined,
    has_reassurance_in_practical_guidance: options?.domain === "pet_clinic" ? petSignals.guidance : undefined,
    rewrite_needed: isConclusionFirst || rewriteScore >= 2 || nearDuplicateWithDraft1 || petReassuranceMissing,
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
    near_duplicate_with_draft1: style.near_duplicate_with_draft1,
    has_reassurance_in_professional_read: style.has_reassurance_in_professional_read,
    has_reassurance_in_attention_points: style.has_reassurance_in_attention_points,
    has_reassurance_in_practical_guidance: style.has_reassurance_in_practical_guidance,
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
