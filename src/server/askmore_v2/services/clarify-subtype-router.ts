import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2ClarifySubtypePrompt } from "@/server/askmore_v2/prompts";
import { AskmoreV2ClarifySubtype } from "@/server/askmore_v2/types";
import { RuntimeContextSnapshot } from "@/server/askmore_v2/runtime/context-engine";

const schema = z.object({
  subtype: z.enum(["referent_clarify", "concept_clarify", "value_clarify"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

export interface ClarifySubtypeResult {
  subtype: AskmoreV2ClarifySubtype;
  confidence: number;
  rationale: string;
}

function isReferentClarify(text: string): boolean {
  return /(你问的是哪种|你说的是哪种|你指的是哪种|前面提到的|前面那个|是前面这个吗|这个状态是指|这种状态是指|which (state|one) (are|do) you mean|the one before|earlier one)/i.test(
    text,
  );
}

function isConceptClarify(text: string): boolean {
  return /(什么意思|什么叫|怎么判断|什么行为算|哪些行为算|怎么算|标准是什么|定义是什么|怎么观察|what does .* mean|what counts as|how to judge|criteria|definition)/i.test(
    text,
  );
}

function isValueClarify(text: string): boolean {
  return /(是.+还是.+|每周还是每天|哪个范围|哪个值|选哪个|a还是b|a or b|which range|which value|per week or per day)/i.test(
    text,
  );
}

function deterministicSubtype(text: string): ClarifySubtypeResult {
  if (isReferentClarify(text)) {
    return {
      subtype: "referent_clarify",
      confidence: 0.96,
      rationale: "referent_signal_rule",
    };
  }
  if (isConceptClarify(text)) {
    return {
      subtype: "concept_clarify",
      confidence: 0.93,
      rationale: "concept_signal_rule",
    };
  }
  if (isValueClarify(text)) {
    return {
      subtype: "value_clarify",
      confidence: 0.9,
      rationale: "value_signal_rule",
    };
  }
  return {
    subtype: "value_clarify",
    confidence: 0.65,
    rationale: "deterministic_default_value_clarify",
  };
}

function applySubtypeRuleCorrections(params: {
  text: string;
  modelResult: ClarifySubtypeResult;
}): ClarifySubtypeResult {
  const text = params.text.trim();
  if (isReferentClarify(text)) {
    return {
      subtype: "referent_clarify",
      confidence: Math.max(0.94, params.modelResult.confidence),
      rationale: "referent_rule_override",
    };
  }
  if (isConceptClarify(text)) {
    return {
      subtype: "concept_clarify",
      confidence: Math.max(0.9, params.modelResult.confidence),
      rationale: "concept_rule_override",
    };
  }
  if (isValueClarify(text)) {
    return {
      subtype: "value_clarify",
      confidence: Math.max(0.88, params.modelResult.confidence),
      rationale: "value_rule_override",
    };
  }
  return params.modelResult;
}

export async function routeClarifySubtype(params: {
  userMessage: string;
  context: RuntimeContextSnapshot;
}): Promise<ClarifySubtypeResult> {
  const userMessage = params.userMessage.trim();
  if (!userMessage) {
    return {
      subtype: "value_clarify",
      confidence: 0.55,
      rationale: "empty_input_default_value_clarify",
    };
  }

  let modelResult: ClarifySubtypeResult;
  try {
    const activeQuestion = params.context.active_question.question?.entry_question
      ?? params.context.active_question.node?.user_facing_entry
      ?? "none";
    const unresolvedGaps = params.context.unresolved_gaps.map((item) => item.label).join(" | ") || "none";
    const referentHints = params.context.recent_confirmed_referents
      .slice(0, 4)
      .map((item) => `${item.label}:${item.value}`)
      .join(" | ") || "none";
    const anchor = params.context.cross_question_anchor
      ? `${params.context.cross_question_anchor.label}:${params.context.cross_question_anchor.value}`
      : "none";

    const result = await generateModelObject({
      system: askmoreV2ClarifySubtypePrompt(),
      prompt: [
        `latest_user_turn: ${userMessage}`,
        `active_question: ${activeQuestion}`,
        `unresolved_gaps: ${unresolvedGaps}`,
        `recent_confirmed_referents: ${referentHints}`,
        `cross_question_anchor: ${anchor}`,
      ].join("\n"),
      schema,
    });
    modelResult = {
      subtype: result.subtype,
      confidence: result.confidence,
      rationale: result.rationale,
    };
  } catch {
    modelResult = deterministicSubtype(userMessage);
  }

  return applySubtypeRuleCorrections({
    text: userMessage,
    modelResult,
  });
}
