import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2SummaryPrompt } from "@/server/askmore_v2/prompts";
import {
  AskmoreV2Language,
  AskmoreV2Session,
  AskmoreV2SummaryOutput,
} from "@/server/askmore_v2/types";
import {
  buildCompletionCaseSummary,
  buildCompletionClosureText,
  detectCompletionDomain,
} from "@/server/askmore_v2/completion-closure";

const schema = z.object({
  summary_text: z.string().min(1),
  structured_report_json: z.object({
    overview: z.string().min(1),
    confirmed_points: z.array(z.string().min(1)).default([]),
    open_points: z.array(z.string().min(1)).default([]),
    next_steps: z.array(z.string().min(1)).default([]),
  }),
});

function appendFinalCompletionNotice(params: {
  language: AskmoreV2Language;
  mode: "progressive" | "final";
  summaryText: string;
  session: AskmoreV2Session;
  messages: Array<{ role: string; message_text: string }>;
}): string {
  const base = params.summaryText.trim();
  if (params.mode !== "final") return base;
  const domain = detectCompletionDomain({
    summaryText: base,
    messages: params.messages,
    state: params.session.state_jsonb,
  });
  const caseSummary = buildCompletionCaseSummary({
    language: params.language,
    summaryText: base,
    state: params.session.state_jsonb,
  });
  return buildCompletionClosureText({
    language: params.language,
    domain,
    caseSummary,
  });
}

function buildFallbackSummary(params: {
  language: AskmoreV2Language;
  session: AskmoreV2Session;
}): AskmoreV2SummaryOutput {
  const knowledgeEntries = Object.entries(params.session.state_jsonb.structured_knowledge);
  const confirmed = knowledgeEntries
    .filter(([, field]) => field.confirmed)
    .map(([key, field]) => `${key}: ${String(field.value ?? "")}`)
    .slice(0, 8);
  const openPoints = params.session.state_jsonb.session.last_missing_points;

  if (params.language === "zh") {
    return {
      summary_text:
        confirmed.length > 0
          ? `当前我们已经确认：${confirmed.join("；")}。${openPoints.length > 0 ? `仍需补充：${openPoints.join("；")}。` : "当前信息已可形成初步报告。"}`
          : "目前已收集到部分信息，但还需要更多具体细节来完善总结。",
      structured_report_json: {
        overview: confirmed.length > 0 ? "已形成阶段性业务理解" : "信息仍在收集中",
        confirmed_points: confirmed,
        open_points: openPoints,
        next_steps:
          openPoints.length > 0
            ? ["补充缺失要点", "确认关键目标用户", "确认下一步优先级"]
            : ["审阅总结", "确认是否继续补充", "进入后续执行规划"],
      },
    };
  }

  return {
    summary_text:
      confirmed.length > 0
        ? `Current confirmed understanding: ${confirmed.join("; ")}. ${openPoints.length > 0 ? `Still missing: ${openPoints.join("; ")}.` : "There is enough information for an initial report."}`
        : "Some information has been collected, but more concrete detail is needed.",
    structured_report_json: {
      overview: confirmed.length > 0 ? "A draft understanding is available" : "Information is still incomplete",
      confirmed_points: confirmed,
      open_points: openPoints,
      next_steps:
        openPoints.length > 0
          ? ["Fill remaining gaps", "Confirm target audience", "Prioritize next actions"]
          : ["Review summary", "Confirm whether to continue", "Move to execution planning"],
    },
  };
}

export async function generateInterviewSummary(params: {
  language: AskmoreV2Language;
  mode: "progressive" | "final";
  session: AskmoreV2Session;
  messages: Array<{ role: string; message_text: string }>;
}): Promise<AskmoreV2SummaryOutput> {
  const knowledge = Object.fromEntries(
    Object.entries(params.session.state_jsonb.structured_knowledge).map(([key, value]) => [key, {
      value: value.value,
      confidence: value.confidence,
      confirmed: value.confirmed,
    }]),
  );

  try {
    const generated = await generateModelObject({
      system: askmoreV2SummaryPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Summary mode: ${params.mode}`,
        `Turn count: ${params.session.turn_count}`,
        `Knowledge JSON: ${JSON.stringify(knowledge)}`,
        `Recent messages JSON: ${JSON.stringify(params.messages.slice(-12))}`,
      ].join("\n\n"),
      schema,
    });
    return {
      ...generated,
      summary_text: appendFinalCompletionNotice({
        language: params.language,
        mode: params.mode,
        summaryText: generated.summary_text,
        session: params.session,
        messages: params.messages,
      }),
    };
  } catch {
    const fallback = buildFallbackSummary({
      language: params.language,
      session: params.session,
    });
    return {
      ...fallback,
      summary_text: appendFinalCompletionNotice({
        language: params.language,
        mode: params.mode,
        summaryText: fallback.summary_text,
        session: params.session,
        messages: params.messages,
      }),
    };
  }
}
