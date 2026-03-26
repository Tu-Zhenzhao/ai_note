import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2ExampleAnswerPrompt } from "@/server/askmore_v2/prompts";
import { AskmoreV2Language } from "@/server/askmore_v2/types";

const schema = z.object({
  example_answers: z.array(z.string().min(1)).min(3).max(4),
});

const GENERIC_ZH_STOPWORDS = new Set([
  "猫咪",
  "猫",
  "情况",
  "问题",
  "这个",
  "那个",
  "现在",
  "当前",
  "描述",
  "说明",
  "特征",
  "辅助",
  "判断",
  "相关",
]);

const GENERIC_EN_STOPWORDS = new Set([
  "cat",
  "cats",
  "question",
  "current",
  "describe",
  "description",
  "feature",
  "features",
  "related",
  "about",
]);

function extractKeywords(text: string): string[] {
  const lowered = text.toLowerCase();
  const english = (lowered.match(/[a-z]{3,}/g) ?? [])
    .filter((token) => !GENERIC_EN_STOPWORDS.has(token));
  const chineseChunks = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const chinese = chineseChunks
    .flatMap((chunk) =>
      chunk
        .split(/的|和|与|及|或|还是|是否|请|描述|说明|情况|问题|这个|那个|一下|里面|导致|辅助|判断/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2),
    )
    .filter((token) => !GENERIC_ZH_STOPWORDS.has(token));

  return [...new Set([...english, ...chinese])].slice(0, 20);
}

function isExampleRelevant(question: string, example: string, gapHints: string[]): boolean {
  const questionKeywords = new Set([
    ...extractKeywords(question),
    ...gapHints.flatMap((item) => extractKeywords(item)),
  ]);
  if (questionKeywords.size === 0) return true;
  const exampleKeywords = new Set(extractKeywords(example));
  if (exampleKeywords.size === 0) return false;
  for (const token of exampleKeywords) {
    if (questionKeywords.has(token)) return true;
  }
  return false;
}

function sanitizeExamples(params: {
  examples: string[];
  question: string;
  gapHints: string[];
}): string[] {
  return params.examples
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => isExampleRelevant(params.question, item, params.gapHints))
    .slice(0, 4);
}

function fallbackExamples(params: {
  language: AskmoreV2Language;
  question: string;
  gapHints: string[];
}): string[] {
  const anchor = (params.gapHints[0] ?? params.question).trim().slice(0, 28);
  if (params.language === "zh") {
    return [
      `最确定的一点是：${anchor}，我观察到有这个表现。`,
      `可以这样补一句：${anchor}在特定场景下更明显，持续时间大概是……`,
      `我不太确定细节，但目前能确认的是：${anchor}相关确实有变化。`,
    ];
  }
  return [
    `The most certain fact is: ${anchor}.`,
    `You can add one concrete detail: it becomes more obvious in specific situations and lasts for...`,
    `I am not fully sure about all details, but this part is clearly changing.`,
  ];
}

export async function generateExampleAnswers(params: {
  language: AskmoreV2Language;
  question: string;
  scenario: string;
  targetOutputType: string;
  knownContext: string[];
  gapHints?: string[];
}): Promise<string[]> {
  const gapHints = params.gapHints ?? [];
  try {
    const result = await generateModelObject({
      system: askmoreV2ExampleAnswerPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Question: ${params.question}`,
        `Gap hints: ${gapHints.join(" | ") || "none"}`,
        `Scenario: ${params.scenario || "general"}`,
        `Target output type: ${params.targetOutputType || "summary"}`,
        `Known context: ${params.knownContext.join(" | ") || "none"}`,
      ].join("\n"),
      schema,
    });
    const cleaned = sanitizeExamples({
      examples: result.example_answers,
      question: params.question,
      gapHints,
    });
    if (cleaned.length >= 2) return cleaned;
    return fallbackExamples({
      language: params.language,
      question: params.question,
      gapHints,
    });
  } catch {
    return fallbackExamples({
      language: params.language,
      question: params.question,
      gapHints,
    });
  }
}
