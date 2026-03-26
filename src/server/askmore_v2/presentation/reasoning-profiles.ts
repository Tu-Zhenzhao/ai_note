export type AskmoreV2ReasoningProfile = "medical_pet" | "consulting" | "business";

export interface AskmoreV2SafeExplanationBoundary {
  id: "medical_pet" | "consulting" | "business";
  enforce_uncertainty: boolean;
  forbid_definitive_diagnosis: boolean;
  forbid_overpromise: boolean;
}

function classifyScene(params: {
  scenario?: string | null;
  targetOutputType?: string | null;
}): "medical_pet" | "business" | "consulting" {
  const text = `${params.scenario ?? ""} ${params.targetOutputType ?? ""}`.toLowerCase();
  if (/(医疗|问诊|宠物|健康|medical|clinic|pet|health)/i.test(text)) return "medical_pet";
  if (/(销售|商业|discovery|sales|business|b2b|增长|增长策略)/i.test(text)) return "business";
  return "consulting";
}

export function resolveReasoningProfile(params: {
  scenario?: string | null;
  targetOutputType?: string | null;
}): AskmoreV2ReasoningProfile {
  return classifyScene(params);
}

export function resolveSafeExplanationBoundary(params: {
  scenario?: string | null;
  targetOutputType?: string | null;
}): AskmoreV2SafeExplanationBoundary {
  const id = classifyScene(params);
  return {
    id,
    enforce_uncertainty: true,
    forbid_definitive_diagnosis: true,
    forbid_overpromise: true,
  };
}

export function reasoningInstruction(profile: AskmoreV2ReasoningProfile, language: "zh" | "en"): string {
  if (profile === "medical_pet") {
    return language === "zh"
      ? "思考方式：先缩小“行为因素 vs 身体不适”的方向，用保守措辞说明为什么这个点会影响排查路径。"
      : "Reasoning: narrow behavior-vs-physical direction first, and explain briefly how this signal affects triage.";
  }
  if (profile === "business") {
    return language === "zh"
      ? "思考方式：优先识别阻塞层级（定位/协同/执行），用简洁句解释为什么继续问这个。"
      : "Reasoning: identify the blocking layer first (positioning/alignment/execution) and explain why the next question matters.";
  }
  return language === "zh"
    ? "思考方式：先确认影响程度与时间线，再缩小理解方向；表达应陪伴式且有判断感。"
    : "Reasoning: clarify impact and timeline first, then narrow the interpretation with a calm, companion-like voice.";
}

export function boundaryInstruction(boundary: AskmoreV2SafeExplanationBoundary, language: "zh" | "en"): string {
  if (language === "zh") {
    return [
      `安全边界(${boundary.id})：`,
      "只可使用“可能/倾向/需要继续确认”等不确定性措辞。",
      "不能给确定性诊断或最终结论，不能承诺结果。",
      "可以解释判断方向，但不能越过当前证据。",
    ].join(" ");
  }
  return [
    `Safety boundary (${boundary.id}):`,
    "Use uncertainty wording such as possible/leaning/need to confirm.",
    "Do not give definitive diagnosis or final conclusion, and do not overpromise outcomes.",
    "You may explain direction of thinking but must stay within current evidence.",
  ].join(" ");
}
