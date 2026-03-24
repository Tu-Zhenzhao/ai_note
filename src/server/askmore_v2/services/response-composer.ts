import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2ResponseComposerPrompt } from "@/server/askmore_v2/prompts";
import {
  AskmoreV2DialoguePlannerOutput,
  AskmoreV2Language,
  AskmoreV2QuestionNode,
  AskmoreV2ResponseBlock,
  AskmoreV2ResponseComposerOutput,
  AskmoreV2TurnExtractorOutput,
} from "@/server/askmore_v2/types";

const responseBlockSchema = z.object({
  type: z.enum([
    "understanding",
    "micro_confirmation",
    "micro_confirm_options",
    "progress",
    "next_question",
    "example_answers",
    "node_summary",
  ]),
  content: z.string().optional(),
  items: z.array(z.string().min(1)).optional(),
  options: z.array(
    z.object({
      option_id: z.string().min(1),
      label: z.string().min(1),
      normalized_value: z.string().min(1),
    }),
  ).optional(),
  dimension_id: z.string().optional(),
  allow_free_text: z.boolean().optional(),
});

const schema = z.object({
  response_blocks: z.array(responseBlockSchema).min(1),
});

function buildUnderstanding(params: {
  language: AskmoreV2Language;
  extractorResult: AskmoreV2TurnExtractorOutput;
}): string {
  const entries = Object.entries(params.extractorResult.facts_extracted);
  if (entries.length === 0) {
    return params.language === "zh"
      ? "我先接住你刚刚的回答。"
      : "I got your latest response.";
  }

  const summary = entries
    .slice(0, 2)
    .map(([, fact]) => fact.value)
    .join("；");

  return params.language === "zh"
    ? `我理解到的重点是：${summary}。`
    : `What I captured is: ${summary}.`;
}

function defaultExamples(language: AskmoreV2Language): string[] {
  if (language === "zh") {
    return ["像是在一点点喷出来", "会舔那里，看起来不太舒服", "这块我不太确定"]; 
  }
  return [
    "It feels like small spraying.",
    "There is some licking and discomfort.",
    "I am not fully sure on this point.",
  ];
}

function sanitizeBlocks(blocks: AskmoreV2ResponseBlock[]): AskmoreV2ResponseBlock[] {
  const next: AskmoreV2ResponseBlock[] = [];
  for (const block of blocks) {
    if (block.type === "example_answers") {
      const items = Array.isArray(block.items)
        ? block.items.map((item) => item.trim()).filter(Boolean).slice(0, 4)
        : [];
      if (items.length === 0) continue;
      next.push({
        type: "example_answers",
        items,
      });
      continue;
    }
    if (block.type === "micro_confirm_options") {
      const options = Array.isArray(block.options)
        ? block.options
            .map((item) => ({
              option_id: String(item.option_id ?? "").trim(),
              label: String(item.label ?? "").trim(),
              normalized_value: String(item.normalized_value ?? "").trim(),
            }))
            .filter((item) => item.option_id && item.label && item.normalized_value)
            .slice(0, 4)
        : [];
      if (options.length === 0) continue;
      next.push({
        type: "micro_confirm_options",
        options,
        dimension_id: block.dimension_id,
        allow_free_text: block.allow_free_text ?? true,
      });
      continue;
    }

    const content = typeof block.content === "string" ? block.content.trim() : "";
    if (!content) continue;
    next.push({
      type: block.type,
      content,
    });
  }
  return next;
}

function fallbackCompose(params: {
  language: AskmoreV2Language;
  extractorResult: AskmoreV2TurnExtractorOutput;
  plannerResult: AskmoreV2DialoguePlannerOutput;
  nextQuestionText: string | null;
  nodeSummaryText: string | null;
  repeatRiskContext?: {
    dimension_id: string;
    acknowledged_value: string;
    reason: string;
  } | null;
}): AskmoreV2ResponseComposerOutput {
  const blocks: AskmoreV2ResponseBlock[] = [];

  if (params.repeatRiskContext?.acknowledged_value) {
    blocks.push({
      type: "understanding",
      content:
        params.language === "zh"
          ? `我先把你刚刚说的记为：${params.repeatRiskContext.acknowledged_value}`
          : `I will first take what you just said as: ${params.repeatRiskContext.acknowledged_value}`,
    });
  } else {
    blocks.push({
      type: "understanding",
      content: buildUnderstanding({
        language: params.language,
        extractorResult: params.extractorResult,
      }),
    });
  }

  if (params.plannerResult.should_show_micro_confirmation) {
    blocks.push({
      type: "micro_confirmation",
      content: params.language === "zh" ? "我这样理解对吗？" : "Did I get that right?",
    });
  }

  blocks.push({
    type: "progress",
    content:
      params.language === "zh"
        ? `这一题我们已经抓到 ${params.plannerResult.progress_signal.covered_count} 个关键点，还差 ${params.plannerResult.progress_signal.remaining_count} 个。`
        : `For this topic, we captured ${params.plannerResult.progress_signal.covered_count} key points and ${params.plannerResult.progress_signal.remaining_count} are still missing.`,
  });

  if (params.nodeSummaryText && params.plannerResult.should_show_node_summary) {
    blocks.push({
      type: "node_summary",
      content: params.nodeSummaryText,
    });
  }

  if (params.nextQuestionText) {
    blocks.push({
      type: "next_question",
      content: params.nextQuestionText,
    });
    blocks.push({
      type: "example_answers",
      items: defaultExamples(params.language),
    });
  }

  return {
    response_blocks: blocks,
  };
}

export async function composeTurnResponse(params: {
  language: AskmoreV2Language;
  currentNode: AskmoreV2QuestionNode;
  extractorResult: AskmoreV2TurnExtractorOutput;
  plannerResult: AskmoreV2DialoguePlannerOutput;
  nextQuestionText: string | null;
  nodeSummaryText: string | null;
  repeatRiskContext?: {
    dimension_id: string;
    acknowledged_value: string;
    reason: string;
  } | null;
}): Promise<AskmoreV2ResponseComposerOutput> {
  try {
    const result = await generateModelObject({
      system: askmoreV2ResponseComposerPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Current node JSON: ${JSON.stringify(params.currentNode)}`,
        `Extractor result JSON: ${JSON.stringify(params.extractorResult)}`,
        `Planner result JSON: ${JSON.stringify(params.plannerResult)}`,
        `Next question (if any): ${params.nextQuestionText ?? "none"}`,
        `Node summary text (if any): ${params.nodeSummaryText ?? "none"}`,
        `Repeat risk context JSON: ${JSON.stringify(params.repeatRiskContext ?? null)}`,
      ].join("\n"),
      schema,
    });

    const sanitized = sanitizeBlocks(result.response_blocks);
    if (sanitized.length === 0) {
      return fallbackCompose(params);
    }

    return {
      response_blocks: sanitized,
    };
  } catch {
    return fallbackCompose(params);
  }
}
