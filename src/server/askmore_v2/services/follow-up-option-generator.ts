import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2FollowUpOptionizePrompt } from "@/server/askmore_v2/prompts";
import { AskmoreV2Language, AskmoreV2MicroConfirmOption } from "@/server/askmore_v2/types";

const schema = z.object({
  options: z.array(z.object({
    option_id: z.string().min(1),
    label: z.string().min(1).max(80),
    normalized_value: z.string().min(1).max(80).optional(),
    rationale: z.string().min(1).max(120).optional(),
  })).min(2).max(4),
});

function slugify(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[\s/]+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "option";
}

function sanitizeOptions(options: AskmoreV2MicroConfirmOption[]): AskmoreV2MicroConfirmOption[] {
  const seen = new Set<string>();
  const out: AskmoreV2MicroConfirmOption[] = [];
  const alphabet = ["A", "B", "C", "D"];
  for (let i = 0; i < options.length && out.length < 4; i += 1) {
    const item = options[i];
    const label = String(item.label ?? "").replace(/\s+/g, " ").trim();
    if (!label || label.length > 80) continue;
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({
      option_id: alphabet[out.length] ?? String.fromCharCode(65 + out.length),
      label,
      normalized_value: String(item.normalized_value ?? "").trim() || slugify(label),
      value: String(item.value ?? "").trim() || undefined,
      rationale: String(item.rationale ?? "").trim() || undefined,
    });
  }
  return out;
}

function looksBooleanQuestion(label: string): boolean {
  return /(是否|有(没有|无)?|会不会|正常吗|有没有|是否有|is there|does|do you|whether|any signs|normal)/i.test(label);
}

function looksFrequencyQuestion(label: string): boolean {
  return /(频率|几次|每[天周月年]|frequency|how often|times per)/i.test(label);
}

function looksTimelineQuestion(label: string): boolean {
  return /(最近|突发|持续|多久|时间线|多久开始|timeline|since when|how long|sudden|recent|duration)/i.test(label);
}

function looksLocationQuestion(label: string): boolean {
  return /(位置|分布|哪里|地点|在哪|location|where|area|spot|distribution)/i.test(label);
}

type BooleanProfile =
  | "normality"
  | "symptom_presence"
  | "severity"
  | "generic";

function detectBooleanProfile(text: string): BooleanProfile {
  if (/(进食|饮水|食欲|正常|食量|喝水|appetite|eating|drinking|normal)/i.test(text)) {
    return "normality";
  }
  if (/(症状|体征|应激|呼吸急促|流涎|腹泻|掉毛|嚎叫|疼|困难|sign|symptom|stress|pant|drool|diarrhea|pain)/i.test(text)) {
    return "symptom_presence";
  }
  if (/(明显|严重|程度|轻微|重度|mild|moderate|severe|obvious|intense)/i.test(text)) {
    return "severity";
  }
  return "generic";
}

function booleanProfileOptions(params: {
  language: AskmoreV2Language;
  profile: BooleanProfile;
}): AskmoreV2MicroConfirmOption[] {
  if (params.language === "zh") {
    if (params.profile === "normality") {
      return sanitizeOptions([
        { option_id: "A", label: "基本正常，和以往差不多", normalized_value: "mostly_normal" },
        { option_id: "B", label: "有些变化，但不算明显", normalized_value: "slight_change" },
        { option_id: "C", label: "明显异常（食量或饮水变化大）", normalized_value: "clear_abnormal" },
        { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
      ]);
    }
    if (params.profile === "symptom_presence") {
      return sanitizeOptions([
        { option_id: "A", label: "有明显症状（至少一种较明显）", normalized_value: "symptom_obvious" },
        { option_id: "B", label: "偶尔有轻微表现", normalized_value: "symptom_mild" },
        { option_id: "C", label: "没有明显症状", normalized_value: "symptom_none" },
        { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
      ]);
    }
    if (params.profile === "severity") {
      return sanitizeOptions([
        { option_id: "A", label: "比较明显，能直接观察到", normalized_value: "severity_high" },
        { option_id: "B", label: "有一点，但不持续", normalized_value: "severity_mild" },
        { option_id: "C", label: "基本不明显", normalized_value: "severity_low" },
        { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
      ]);
    }
    return sanitizeOptions([
      { option_id: "A", label: "有，会出现", normalized_value: "yes_present" },
      { option_id: "B", label: "没有，没有出现", normalized_value: "no_absent" },
      { option_id: "C", label: "不太确定", normalized_value: "uncertain" },
    ]);
  }

  if (params.profile === "normality") {
    return sanitizeOptions([
      { option_id: "A", label: "Mostly normal, similar to usual", normalized_value: "mostly_normal" },
      { option_id: "B", label: "Some changes, but not obvious", normalized_value: "slight_change" },
      { option_id: "C", label: "Clearly abnormal (eating/drinking changed a lot)", normalized_value: "clear_abnormal" },
      { option_id: "D", label: "Not sure", normalized_value: "uncertain" },
    ]);
  }
  if (params.profile === "symptom_presence") {
    return sanitizeOptions([
      { option_id: "A", label: "Clear symptoms present", normalized_value: "symptom_obvious" },
      { option_id: "B", label: "Occasional mild signs", normalized_value: "symptom_mild" },
      { option_id: "C", label: "No obvious symptoms", normalized_value: "symptom_none" },
      { option_id: "D", label: "Not sure", normalized_value: "uncertain" },
    ]);
  }
  if (params.profile === "severity") {
    return sanitizeOptions([
      { option_id: "A", label: "Quite obvious", normalized_value: "severity_high" },
      { option_id: "B", label: "Mild or occasional", normalized_value: "severity_mild" },
      { option_id: "C", label: "Barely noticeable", normalized_value: "severity_low" },
      { option_id: "D", label: "Not sure", normalized_value: "uncertain" },
    ]);
  }
  return sanitizeOptions([
    { option_id: "A", label: "Yes, it happens", normalized_value: "yes_present" },
    { option_id: "B", label: "No, it does not happen", normalized_value: "no_absent" },
    { option_id: "C", label: "Not sure", normalized_value: "uncertain" },
  ]);
}

function structuredOptions(params: {
  language: AskmoreV2Language;
  dimensionLabel: string;
}): AskmoreV2MicroConfirmOption[] | null {
  const label = params.dimensionLabel;

  if (looksFrequencyQuestion(label)) {
    if (params.language === "zh") {
      return sanitizeOptions([
        { option_id: "A", label: "偶尔（每周1-2次）", normalized_value: "weekly_1_2" },
        { option_id: "B", label: "中等（每周3-4次）", normalized_value: "weekly_3_4" },
        { option_id: "C", label: "频繁（几乎每天）", normalized_value: "almost_daily" },
        { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
      ]);
    }
    return sanitizeOptions([
      { option_id: "A", label: "Occasional (1-2 times/week)", normalized_value: "weekly_1_2" },
      { option_id: "B", label: "Moderate (3-4 times/week)", normalized_value: "weekly_3_4" },
      { option_id: "C", label: "Frequent (almost daily)", normalized_value: "almost_daily" },
      { option_id: "D", label: "Not sure", normalized_value: "uncertain" },
    ]);
  }

  if (looksTimelineQuestion(label)) {
    if (params.language === "zh") {
      return sanitizeOptions([
        { option_id: "A", label: "最近几天才明显", normalized_value: "recent_days" },
        { option_id: "B", label: "最近几周开始", normalized_value: "recent_weeks" },
        { option_id: "C", label: "已经持续一段时间", normalized_value: "ongoing_longer" },
        { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
      ]);
    }
    return sanitizeOptions([
      { option_id: "A", label: "Became clear in recent days", normalized_value: "recent_days" },
      { option_id: "B", label: "Started in recent weeks", normalized_value: "recent_weeks" },
      { option_id: "C", label: "Ongoing for a while", normalized_value: "ongoing_longer" },
      { option_id: "D", label: "Not sure", normalized_value: "uncertain" },
    ]);
  }

  if (looksLocationQuestion(label)) {
    if (params.language === "zh") {
      return sanitizeOptions([
        { option_id: "A", label: "主要在一个固定位置", normalized_value: "single_spot" },
        { option_id: "B", label: "在几个位置都会出现", normalized_value: "multiple_spots" },
        { option_id: "C", label: "会在不同地方随机出现", normalized_value: "random_spots" },
        { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
      ]);
    }
    return sanitizeOptions([
      { option_id: "A", label: "Mostly one fixed location", normalized_value: "single_spot" },
      { option_id: "B", label: "Appears in several locations", normalized_value: "multiple_spots" },
      { option_id: "C", label: "Random across different spots", normalized_value: "random_spots" },
      { option_id: "D", label: "Not sure", normalized_value: "uncertain" },
    ]);
  }

  return null;
}

function genericFallbackOptions(language: AskmoreV2Language): AskmoreV2MicroConfirmOption[] {
  if (language === "zh") {
    return sanitizeOptions([
      { option_id: "A", label: "更接近第一种情况", normalized_value: "option_a" },
      { option_id: "B", label: "更接近第二种情况", normalized_value: "option_b" },
      { option_id: "C", label: "更接近第三种情况", normalized_value: "option_c" },
      { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
    ]);
  }
  return sanitizeOptions([
    { option_id: "A", label: "Closer to option one", normalized_value: "option_a" },
    { option_id: "B", label: "Closer to option two", normalized_value: "option_b" },
    { option_id: "C", label: "Closer to option three", normalized_value: "option_c" },
    { option_id: "D", label: "Not sure", normalized_value: "uncertain" },
  ]);
}

export async function generateFollowUpOptions(params: {
  language: AskmoreV2Language;
  activeQuestionText: string;
  dimensionLabel: string;
  gapHints: string[];
  userMessage: string;
}): Promise<AskmoreV2MicroConfirmOption[] | null> {
  const isBooleanLike = looksBooleanQuestion(params.dimensionLabel);
  const fromStructure = structuredOptions({
    language: params.language,
    dimensionLabel: params.dimensionLabel,
  });
  if (fromStructure && fromStructure.length >= 2) return fromStructure;

  const booleanFallback = isBooleanLike
    ? booleanProfileOptions({
        language: params.language,
        profile: detectBooleanProfile(`${params.dimensionLabel} ${params.activeQuestionText} ${params.gapHints.join(" ")}`),
      })
    : null;

  const shouldTryModelFirst = !isBooleanLike || process.env.NODE_ENV !== "test";

  if (shouldTryModelFirst) {
    try {
      const result = await generateModelObject({
        system: askmoreV2FollowUpOptionizePrompt(),
        prompt: [
          `language: ${params.language}`,
          `active_question_text: ${params.activeQuestionText}`,
          `target_gap: ${params.dimensionLabel}`,
          `gap_hints: ${JSON.stringify(params.gapHints.slice(0, 3))}`,
          `latest_user_turn: ${params.userMessage}`,
        ].join("\n"),
        schema,
      });

      const normalized = sanitizeOptions(result.options.map((item) => ({
        option_id: item.option_id,
        label: item.label,
        normalized_value: item.normalized_value ?? slugify(item.label),
        rationale: item.rationale,
      })));
      if (normalized.length >= 2) return normalized;
    } catch {
      // degrade to deterministic fallback below
    }
  }

  if (booleanFallback && booleanFallback.length >= 2) return booleanFallback;

  const fallback = genericFallbackOptions(params.language);
  return fallback.length >= 2 ? fallback : null;
}
