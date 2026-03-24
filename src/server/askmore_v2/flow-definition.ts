import {
  AskmoreV2FlowDefinition,
  AskmoreV2FlowDefinitionV2,
  AskmoreV2FlowQuestion,
  AskmoreV2Language,
  AskmoreV2LegacyFlowDefinition,
  AskmoreV2QuestionCandidate,
  AskmoreV2QuestionCard,
  AskmoreV2QuestionFinalPayload,
  AskmoreV2SelectionMode,
} from "@/server/askmore_v2/types";

function cleanText(value: unknown, fallback = ""): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function cleanList(values: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(values)) return [...fallback];
  const cleaned = values
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return cleaned.length > 0 ? cleaned : [...fallback];
}

function normalizeSelectionMode(value: unknown): AskmoreV2SelectionMode {
  if (value === "use_original" || value === "custom_manual" || value === "use_ai_refined") {
    return value;
  }
  return "use_ai_refined";
}

function normalizeCandidate(candidate: Partial<AskmoreV2QuestionCandidate>, originalQuestion: string): AskmoreV2QuestionCandidate {
  const recommended = cleanText(candidate.recommended_strategy, "progressive_expand");
  const entry = cleanText(candidate.entry_question, originalQuestion);
  const subQuestions = cleanList(candidate.sub_questions, []);
  const styles = cleanList(candidate.example_answer_styles, ["一句话版", "举例版"]);

  return {
    entry_question: entry,
    sub_questions: subQuestions,
    example_answer_styles: styles,
    recommended_strategy: recommended,
  };
}

export function deriveFinalPayload(params: {
  originalQuestion: string;
  aiCandidate: AskmoreV2QuestionCandidate;
  selectionMode: AskmoreV2SelectionMode;
  manualPayload?: Partial<AskmoreV2QuestionFinalPayload> | null;
}): AskmoreV2QuestionFinalPayload {
  if (params.selectionMode === "custom_manual") {
    const manual = params.manualPayload ?? {};
    return {
      entry_question: cleanText(manual.entry_question, params.aiCandidate.entry_question),
      sub_questions: cleanList(manual.sub_questions, params.aiCandidate.sub_questions),
      example_answer_styles: cleanList(manual.example_answer_styles, params.aiCandidate.example_answer_styles),
      recommended_strategy: cleanText(manual.recommended_strategy, params.aiCandidate.recommended_strategy),
      source_mode: "custom_manual",
    };
  }

  if (params.selectionMode === "use_original") {
    return {
      entry_question: cleanText(params.originalQuestion, params.aiCandidate.entry_question),
      sub_questions: [...params.aiCandidate.sub_questions],
      example_answer_styles: [...params.aiCandidate.example_answer_styles],
      recommended_strategy: cleanText(params.aiCandidate.recommended_strategy, "keep_original_with_ai_support"),
      source_mode: "use_original",
    };
  }

  return {
    entry_question: params.aiCandidate.entry_question,
    sub_questions: [...params.aiCandidate.sub_questions],
    example_answer_styles: [...params.aiCandidate.example_answer_styles],
    recommended_strategy: params.aiCandidate.recommended_strategy,
    source_mode: "use_ai_refined",
  };
}

export function toFlowQuestion(card: AskmoreV2QuestionCard): AskmoreV2FlowQuestion {
  return {
    question_id: card.question_id,
    original_question: card.original_question,
    entry_question: card.final_payload.entry_question,
    sub_questions: [...card.final_payload.sub_questions],
    example_answer_styles: [...card.final_payload.example_answer_styles],
    recommended_strategy: card.final_payload.recommended_strategy,
    source_mode: card.final_payload.source_mode,
  };
}

export function normalizeQuestionCard(raw: Partial<AskmoreV2QuestionCard>, index: number): AskmoreV2QuestionCard {
  const originalQuestion = cleanText(raw.original_question, `Question ${index + 1}`);
  const aiCandidate = normalizeCandidate(raw.ai_candidate ?? {}, originalQuestion);
  const selectionMode = normalizeSelectionMode(raw.selection?.mode);
  const finalPayload = deriveFinalPayload({
    originalQuestion,
    aiCandidate,
    selectionMode,
    manualPayload: raw.final_payload,
  });

  return {
    question_id: cleanText(raw.question_id, `q${index + 1}`),
    original_question: originalQuestion,
    analysis: {
      evaluation: {
        is_too_broad: Boolean(raw.analysis?.evaluation?.is_too_broad),
        is_too_abstract: Boolean(raw.analysis?.evaluation?.is_too_abstract),
        difficulty:
          raw.analysis?.evaluation?.difficulty === "low" ||
          raw.analysis?.evaluation?.difficulty === "medium" ||
          raw.analysis?.evaluation?.difficulty === "high"
            ? raw.analysis.evaluation.difficulty
            : "medium",
      },
      reason: cleanText(raw.analysis?.reason, ""),
    },
    ai_candidate: aiCandidate,
    selection: {
      mode: selectionMode,
    },
    final_payload: finalPayload,
    review_generation_meta: raw.review_generation_meta
      ? { used_fallback: Boolean(raw.review_generation_meta.used_fallback) }
      : undefined,
  };
}

export function legacyFlowToV2(flow: AskmoreV2LegacyFlowDefinition): AskmoreV2FlowDefinitionV2 {
  const cards = (flow.review_items ?? []).map((item, index) => {
    const aiCandidate = normalizeCandidate(
      {
        entry_question: item.entry_question,
        sub_questions: item.sub_questions,
        example_answer_styles: item.example_answer_styles,
        recommended_strategy: item.recommended_strategy,
      },
      item.original_question,
    );
    const mode: AskmoreV2SelectionMode = item.adopted ? "use_ai_refined" : "use_original";
    const finalPayload = deriveFinalPayload({
      originalQuestion: item.original_question,
      aiCandidate,
      selectionMode: mode,
    });

    return normalizeQuestionCard(
      {
        question_id: item.question_id,
        original_question: item.original_question,
        analysis: {
          evaluation: item.evaluation,
          reason: item.reason,
        },
        ai_candidate: aiCandidate,
        selection: { mode },
        final_payload: finalPayload,
        review_generation_meta: { used_fallback: false },
      },
      index,
    );
  });

  return {
    schema_version: 2,
    raw_questions: (flow.raw_questions ?? []).map((q) => cleanText(q)).filter(Boolean),
    scenario: cleanText(flow.scenario, "general interview"),
    target_output_type: cleanText(flow.target_output_type, "summary report"),
    language: (flow.language ?? "zh") as AskmoreV2Language,
    cards_snapshot: cards,
    final_flow_questions: cards.map(toFlowQuestion),
    review_generation_meta: {
      used_fallback: false,
      fallback_count: 0,
    },
  };
}

export function toCanonicalFlowDefinition(flow: AskmoreV2FlowDefinition): AskmoreV2FlowDefinitionV2 {
  if ((flow as AskmoreV2FlowDefinitionV2).schema_version === 2) {
    const v2 = flow as AskmoreV2FlowDefinitionV2;
    const cards = (v2.cards_snapshot ?? []).map((card, index) => normalizeQuestionCard(card, index));
    const finalFlow = cards.map(toFlowQuestion);

    return {
      schema_version: 2,
      raw_questions: (v2.raw_questions ?? []).map((q) => cleanText(q)).filter(Boolean),
      scenario: cleanText(v2.scenario, "general interview"),
      target_output_type: cleanText(v2.target_output_type, "summary report"),
      language: (v2.language ?? "zh") as AskmoreV2Language,
      cards_snapshot: cards,
      final_flow_questions: finalFlow,
      review_generation_meta: {
        used_fallback: Boolean(v2.review_generation_meta?.used_fallback),
        fallback_count: Number(v2.review_generation_meta?.fallback_count ?? 0),
      },
    };
  }

  return legacyFlowToV2(flow as AskmoreV2LegacyFlowDefinition);
}
