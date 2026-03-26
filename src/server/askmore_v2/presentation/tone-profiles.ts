export type AskmoreV2ToneProfile = "medical_pet" | "consulting" | "business";

export function resolveToneProfile(params: {
  scenario?: string | null;
  targetOutputType?: string | null;
}): AskmoreV2ToneProfile {
  const text = `${params.scenario ?? ""} ${params.targetOutputType ?? ""}`.toLowerCase();
  if (/(医疗|问诊|宠物|健康|medical|clinic|pet|health)/i.test(text)) return "medical_pet";
  if (/(销售|商业|discovery|sales|business|b2b|增长|增长策略)/i.test(text)) return "business";
  if (/(咨询|心理|辅导|therapy|counseling|intake|coach)/i.test(text)) return "consulting";
  return "consulting";
}

export function toneInstruction(profile: AskmoreV2ToneProfile, language: "zh" | "en"): string {
  if (profile === "medical_pet") {
    return language === "zh"
      ? "语气：稳、清楚、略带安抚，避免恐吓和过度结论。"
      : "Tone: calm, clear, lightly reassuring; avoid alarmist or absolute conclusions.";
  }
  if (profile === "business") {
    return language === "zh"
      ? "语气：直接、推进感强、结论导向，但保持礼貌。"
      : "Tone: direct and forward-moving, outcome-oriented, while staying polite.";
  }
  return language === "zh"
    ? "语气：共情、慢节奏、自然，不机械。"
    : "Tone: empathetic, measured pace, natural and non-robotic.";
}
