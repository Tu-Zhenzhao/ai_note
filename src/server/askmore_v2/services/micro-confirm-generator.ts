import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2MicroConfirmGeneratorPrompt } from "@/server/askmore_v2/prompts";
import { AskmoreV2Language, AskmoreV2MicroConfirmOption, AskmoreV2UnresolvedReason } from "@/server/askmore_v2/types";

const optionSchema = z.object({
  option_id: z.string().min(1),
  label: z.string().min(1),
  normalized_value: z.string().min(1),
});

const schema = z.object({
  ack_text: z.string().min(1),
  options: z.array(optionSchema).min(3).max(4),
  allow_free_text: z.boolean(),
});

function sanitizeOptions(options: AskmoreV2MicroConfirmOption[]): AskmoreV2MicroConfirmOption[] {
  const out: AskmoreV2MicroConfirmOption[] = [];
  const seen = new Set<string>();
  for (const [idx, item] of options.entries()) {
    const label = item.label.trim();
    const normalized = item.normalized_value.trim();
    if (!label || !normalized) continue;
    const optionId = (item.option_id || String.fromCharCode(65 + idx)).trim();
    if (seen.has(optionId)) continue;
    seen.add(optionId);
    out.push({
      option_id: optionId,
      label,
      normalized_value: normalized,
    });
    if (out.length >= 4) break;
  }
  return out;
}

function fallbackOptions(params: {
  language: AskmoreV2Language;
  dimensionLabel: string;
  dimensionId?: string;
  unresolvedReason?: AskmoreV2UnresolvedReason | null;
}): AskmoreV2MicroConfirmOption[] {
  const label = `${params.dimensionId ?? ""} ${params.dimensionLabel}`;
  if (params.unresolvedReason === "ambiguous_temporal" || /开始|时机|最近|多久|持续|发生|onset|timing|start|duration/i.test(label)) {
    return [
      { option_id: "A", label: "最近几天才开始", normalized_value: "started_recent_days" },
      { option_id: "B", label: "最近几周开始的", normalized_value: "started_recent_weeks" },
      { option_id: "C", label: "最近几个月才明显", normalized_value: "started_recent_months" },
      { option_id: "D", label: "一直以来都有", normalized_value: "longstanding" },
    ];
  }
  if (/位置|地点|哪里|猫砂盆|床|衣物|location|where/i.test(label)) {
    return [
      { option_id: "A", label: "就在猫砂盆内", normalized_value: "inside_litter_box" },
      { option_id: "B", label: "猫砂盆外，但在盆附近", normalized_value: "near_litter_box_outside" },
      { option_id: "C", label: "在床铺或衣物等软织物上", normalized_value: "soft_surfaces" },
      { option_id: "D", label: "不太确定或有其他情况", normalized_value: "uncertain_or_other" },
    ];
  }
  if (/分布|局部|对称|散在|范围/.test(label)) {
    return [
      { option_id: "A", label: "更像局部小块", normalized_value: "localized_small_patches" },
      { option_id: "B", label: "更像两侧对称", normalized_value: "bilateral_symmetric" },
      { option_id: "C", label: "更像全身散在", normalized_value: "diffuse_scattered" },
      { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
    ];
  }
  if (/持续|多久|时长|时间/.test(label)) {
    return [
      { option_id: "A", label: "不到一周", normalized_value: "<1_week" },
      { option_id: "B", label: "1到3周", normalized_value: "1_to_3_weeks" },
      { option_id: "C", label: "超过3周", normalized_value: ">3_weeks" },
      { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
    ];
  }
  if (/皮屑|红点|结痂|瘙痒|不适|症状/.test(label)) {
    return [
      { option_id: "A", label: "基本没有", normalized_value: "none_observed" },
      { option_id: "B", label: "偶尔有一点", normalized_value: "mild_signs" },
      { option_id: "C", label: "比较明显", normalized_value: "obvious_signs" },
      { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
    ];
  }
  if (params.language === "zh") {
    return [
      { option_id: "A", label: "更接近第一种", normalized_value: "option_a" },
      { option_id: "B", label: "更接近第二种", normalized_value: "option_b" },
      { option_id: "C", label: "更接近第三种", normalized_value: "option_c" },
      { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
    ];
  }
  return [
    { option_id: "A", label: "Closer to option one", normalized_value: "option_a" },
    { option_id: "B", label: "Closer to option two", normalized_value: "option_b" },
    { option_id: "C", label: "Closer to option three", normalized_value: "option_c" },
    { option_id: "D", label: "Not sure", normalized_value: "uncertain" },
  ];
}

function optionsLookTemporal(options: AskmoreV2MicroConfirmOption[]): boolean {
  return options.filter((item) => /(最近|几天|几周|几个月|一直以来|常年|started|weeks|months|longstanding)/i.test(item.label)).length >= 2;
}

function optionsLookLocation(options: AskmoreV2MicroConfirmOption[]): boolean {
  return options.filter((item) => /(猫砂盆|床|衣物|软织物|位置|地点|location|litter|where)/i.test(item.label)).length >= 2;
}

function shouldEnforceTemporal(params: {
  dimensionLabel: string;
  dimensionId: string;
  unresolvedReason?: AskmoreV2UnresolvedReason | null;
}): boolean {
  if (params.unresolvedReason === "ambiguous_temporal") return true;
  return /(onset|timing|start|duration|开始|时机|最近|持续|发生)/i.test(`${params.dimensionId} ${params.dimensionLabel}`);
}

function shouldEnforceLocation(params: {
  dimensionLabel: string;
  dimensionId: string;
}): boolean {
  return /(location|where|位置|地点|猫砂盆|床|衣物)/i.test(`${params.dimensionId} ${params.dimensionLabel}`);
}

function normalizeEvidenceSnippet(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 64) return trimmed;
  return `${trimmed.slice(0, 64)}...`;
}

function buildExplanatoryAck(params: {
  language: AskmoreV2Language;
  userEvidence: string;
  dimensionLabel: string;
}): string {
  const evidence = normalizeEvidenceSnippet(params.userEvidence) || (params.language === "zh" ? "你刚刚的描述" : "your latest answer");
  if (params.language === "zh") {
    return `你这个回答很有帮助，我已经理解到：${evidence}。为了记录更精确（主要是「${params.dimensionLabel}」这个点），我只补一个很小的确认，点一下最接近的选项就行。`;
  }
  return `Your answer is very helpful, and I understand it as: ${evidence}. To record it more precisely (mainly for "${params.dimensionLabel}"), I only need one small confirmation. Just tap the closest option.`;
}

export async function generateMicroConfirmation(params: {
  language: AskmoreV2Language;
  dimensionId: string;
  dimensionLabel: string;
  userEvidence: string;
  candidateValue: string | null;
  unresolvedReason?: AskmoreV2UnresolvedReason | null;
}): Promise<{
  ack_text: string;
  options: AskmoreV2MicroConfirmOption[];
  allow_free_text: boolean;
}> {
  try {
    const result = await generateModelObject({
      system: askmoreV2MicroConfirmGeneratorPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Current dimension id: ${params.dimensionId}`,
        `Current dimension label: ${params.dimensionLabel}`,
        `User evidence: ${params.userEvidence}`,
        `Candidate value: ${params.candidateValue ?? "none"}`,
        `Unresolved reason: ${params.unresolvedReason ?? "none"}`,
      ].join("\n"),
      schema,
    });
    const ackText = buildExplanatoryAck({
      language: params.language,
      userEvidence: params.userEvidence || result.ack_text,
      dimensionLabel: params.dimensionLabel,
    });
    const options = sanitizeOptions(result.options);
    if (options.length < 3) {
      return {
        ack_text: ackText,
        options: fallbackOptions({
          language: params.language,
          dimensionId: params.dimensionId,
          dimensionLabel: params.dimensionLabel,
          unresolvedReason: params.unresolvedReason ?? null,
        }),
        allow_free_text: true,
      };
    }

    if (shouldEnforceTemporal({
      dimensionId: params.dimensionId,
      dimensionLabel: params.dimensionLabel,
      unresolvedReason: params.unresolvedReason ?? null,
    }) && !optionsLookTemporal(options)) {
      return {
        ack_text: ackText,
        options: fallbackOptions({
          language: params.language,
          dimensionId: params.dimensionId,
          dimensionLabel: params.dimensionLabel,
          unresolvedReason: "ambiguous_temporal",
        }),
        allow_free_text: true,
      };
    }

    if (shouldEnforceLocation({
      dimensionId: params.dimensionId,
      dimensionLabel: params.dimensionLabel,
    }) && !optionsLookLocation(options)) {
      return {
        ack_text: ackText,
        options: fallbackOptions({
          language: params.language,
          dimensionId: params.dimensionId,
          dimensionLabel: params.dimensionLabel,
          unresolvedReason: params.unresolvedReason ?? null,
        }),
        allow_free_text: true,
      };
    }

    return {
      ack_text: ackText,
      options,
      allow_free_text: true,
    };
  } catch {
    return {
      ack_text: buildExplanatoryAck({
        language: params.language,
        userEvidence: params.userEvidence,
        dimensionLabel: params.dimensionLabel,
      }),
      options: fallbackOptions({
        language: params.language,
        dimensionId: params.dimensionId,
        dimensionLabel: params.dimensionLabel,
        unresolvedReason: params.unresolvedReason ?? null,
      }),
      allow_free_text: true,
    };
  }
}
