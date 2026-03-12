import {
  SuperV1ChecklistAnswer,
  SuperV1ExtractionOutput,
  SuperV1TemplateQuestion,
  SuperV1ValidatedExtraction,
} from "@/server/superv1/types";

export const SUPERV1_MIN_CONFIDENCE = 0.75;

function hasUsableValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function isEditable(answer: SuperV1ChecklistAnswer | undefined): boolean {
  return !answer || answer.status !== "confirmed";
}

export function validateExtraction(params: {
  extraction: SuperV1ExtractionOutput;
  openQuestions: SuperV1TemplateQuestion[];
  answers: SuperV1ChecklistAnswer[];
}): SuperV1ValidatedExtraction {
  const openMap = new Map(params.openQuestions.map((q) => [q.question_id, q]));
  const answerMap = new Map(params.answers.map((a) => [a.question_id, a]));

  const accepted = [];
  const rejected: SuperV1ValidatedExtraction["rejected_updates"] = [];

  for (const item of params.extraction.filled_items) {
    const question = openMap.get(item.question_id);
    if (!question) {
      rejected.push({ question_id: item.question_id, reason: "question_not_open", confidence: item.confidence });
      continue;
    }
    if (!isEditable(answerMap.get(item.question_id))) {
      rejected.push({ question_id: item.question_id, reason: "question_locked", confidence: item.confidence });
      continue;
    }
    if (item.confidence < SUPERV1_MIN_CONFIDENCE) {
      rejected.push({ question_id: item.question_id, reason: "confidence_below_threshold", confidence: item.confidence });
      continue;
    }
    if (!item.evidence.trim()) {
      rejected.push({ question_id: item.question_id, reason: "missing_evidence", confidence: item.confidence });
      continue;
    }
    if (!hasUsableValue(item.value)) {
      rejected.push({ question_id: item.question_id, reason: "empty_or_noise_value", confidence: item.confidence });
      continue;
    }
    accepted.push(item);
  }

  const ambiguous = params.extraction.ambiguous_items.filter((item) => openMap.has(item.question_id));

  return {
    accepted_updates: accepted,
    rejected_updates: rejected,
    ambiguous_items: ambiguous,
  };
}

