import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2ExampleAnswerPrompt } from "@/server/askmore_v2/prompts";
import { AskmoreV2Language } from "@/server/askmore_v2/types";

const schema = z.object({
  example_answers: z.array(z.string().min(1)).min(3).max(4),
});

export async function generateExampleAnswers(params: {
  language: AskmoreV2Language;
  question: string;
  scenario: string;
  targetOutputType: string;
  knownContext: string[];
}): Promise<string[]> {
  try {
    const result = await generateModelObject({
      system: askmoreV2ExampleAnswerPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Question: ${params.question}`,
        `Scenario: ${params.scenario || "general"}`,
        `Target output type: ${params.targetOutputType || "summary"}`,
        `Known context: ${params.knownContext.join(" | ") || "none"}`,
      ].join("\n"),
      schema,
    });
    return result.example_answers;
  } catch {
    if (params.language === "zh") {
      return [
        "我们现在主要在做……",
        "目前还在早期探索，重点是……",
        "我还没完全想清楚，但大方向是……",
      ];
    }
    return [
      "Right now we mainly do...",
      "We are still early stage, and the focus is...",
      "I am not fully sure yet, but the direction is...",
    ];
  }
}
