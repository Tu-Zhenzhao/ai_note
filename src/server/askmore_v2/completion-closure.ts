import {
  AskmoreV2Language,
  AskmoreV2SessionState,
  AskmoreV2StructuredKnowledgeField,
} from "@/server/askmore_v2/types";

export type AskmoreV2CompletionDomain = "pet_clinic" | "general";

const PET_DOMAIN_PATTERN = /(宠物|猫|狗|pet|vet|veterinary|clinic|feline|canine|猫咪|狗狗)/i;

function normalizeKnowledgeLabel(key: string): string {
  return key
    .replace(/^q\d+__/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const part = normalized.split(/[。！？!?]/).find((item) => item.trim().length > 0)?.trim() ?? "";
  return part || normalized;
}

export function detectCompletionDomain(params: {
  scenario?: string | null;
  targetOutputType?: string | null;
  transitionContent?: string | null;
  understanding?: string | null;
  summaryText?: string | null;
  messages?: Array<{ role: string; message_text: string }>;
  state?: AskmoreV2SessionState;
}): AskmoreV2CompletionDomain {
  const messageText = (params.messages ?? []).slice(-8).map((item) => item.message_text).join("\n");
  const knowledgeText = params.state
    ? Object.entries(params.state.structured_knowledge ?? {})
      .map(([key, field]) => `${key}:${String(field.value ?? "")}`)
      .join("\n")
    : "";
  const combined = [
    params.scenario ?? "",
    params.targetOutputType ?? "",
    params.transitionContent ?? "",
    params.understanding ?? "",
    params.summaryText ?? "",
    messageText,
    knowledgeText,
  ].join("\n");
  return PET_DOMAIN_PATTERN.test(combined) ? "pet_clinic" : "general";
}

function extractKnowledgeHighlights(params: {
  language: AskmoreV2Language;
  state: AskmoreV2SessionState;
}): string[] {
  const entries = Object.entries(params.state.structured_knowledge ?? {})
    .filter(([, field]) => Boolean(field?.confirmed) && String(field?.value ?? "").trim().length > 0)
    .slice(0, 3);

  return entries.map(([key, field]) => {
    const value = String((field as AskmoreV2StructuredKnowledgeField).value ?? "").trim();
    const label = normalizeKnowledgeLabel(key);
    if (!label) return value;
    return params.language === "zh" ? `${label}：${value}` : `${label}: ${value}`;
  }).filter((item) => item.length > 0);
}

export function buildCompletionCaseSummary(params: {
  language: AskmoreV2Language;
  understanding?: string | null;
  summaryText?: string | null;
  state?: AskmoreV2SessionState;
}): string {
  const fromUnderstanding = firstSentence(params.understanding ?? "");
  if (fromUnderstanding) return fromUnderstanding;

  const fromSummary = firstSentence(params.summaryText ?? "");
  if (fromSummary) return fromSummary;

  if (params.state) {
    const highlights = extractKnowledgeHighlights({
      language: params.language,
      state: params.state,
    });
    if (highlights.length > 0) {
      return params.language === "zh"
        ? `根据你的描述，目前已确认的关键点包括：${highlights.join("；")}。`
        : `From your responses, the key confirmed points include: ${highlights.join("; ")}.`;
    }
  }

  return params.language === "zh"
    ? "根据你的描述，我们已经把这次访谈最关键的信息收齐了。"
    : "Based on your responses, we have captured the key information for this interview.";
}

export function buildCompletionClosureText(params: {
  language: AskmoreV2Language;
  domain: AskmoreV2CompletionDomain;
  caseSummary: string;
}): string {
  const summary = params.caseSummary.trim();
  if (params.language === "zh") {
    const opening = params.domain === "pet_clinic" ? "本次健康咨询已完成。" : "本次访谈已完成。";
    const paragraph1 = `${opening}\n${summary}`;
    const paragraph2 = [
      "本次访谈已经结束。正常情况下只需要等待几秒，你就可以在电脑端右侧看到「AI思考」面板里的完整分析；如果你在手机端，请滑动到页面最底部查看。",
      "如果你对首次生成结果不满意，也可以再次点击「AI思考」按钮进行重跑。",
      "另外，问题进度已经完成，这是一个好消息；我们会尽快把这次结果同步给提问方，让对方第一时间了解情况。",
    ].join("\n");
    return `${paragraph1}\n\n${paragraph2}`.trim();
  }

  const opening = "This interview is complete.";
  const paragraph1 = `${opening}\n${summary}`;
  const paragraph2 = [
    "The interview is now closed. In normal cases, wait a few seconds and you can open the AI Thinking panel on the right in desktop view; on mobile, scroll to the bottom to see it.",
    "If the first result does not match your expectation, you can click AI Thinking again to rerun.",
    "Your question progress is complete, which is good news, and we will sync this result to the question owner as soon as possible.",
  ].join("\n");
  return `${paragraph1}\n\n${paragraph2}`.trim();
}
