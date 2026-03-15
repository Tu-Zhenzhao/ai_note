import {
  SuperV1AiSuggestedDirectionsPayload,
  SuperV1ChecklistAnswer,
  SuperV1Conversation,
  SuperV1ExtractionItem,
  SuperV1PlannerResult,
  SuperV1StateView,
  SuperV1TemplateQuestion,
  SuperV1ValidatedExtraction,
} from "@/server/superv1/types";
import { SuperV1Repository } from "@/server/superv1/repo/contracts";

function sortTemplateQuestions(questions: SuperV1TemplateQuestion[]): SuperV1TemplateQuestion[] {
  return [...questions].sort((a, b) => a.display_order - b.display_order);
}

function sectionOrder(questions: SuperV1TemplateQuestion[]): string[] {
  const ordered = sortTemplateQuestions(questions);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const q of ordered) {
    if (seen.has(q.section_id)) continue;
    seen.add(q.section_id);
    result.push(q.section_id);
  }
  return result;
}

function answerByQuestionId(answers: SuperV1ChecklistAnswer[]): Map<string, SuperV1ChecklistAnswer> {
  const map = new Map<string, SuperV1ChecklistAnswer>();
  for (const answer of answers) {
    map.set(answer.question_id, answer);
  }
  return map;
}

function isRequiredOpen(answer: SuperV1ChecklistAnswer | undefined, question: SuperV1TemplateQuestion): boolean {
  if (!question.is_required) return false;
  if (!answer) return true;
  return answer.status === "empty" || answer.status === "needs_clarification";
}

function isQuestionEditable(answer: SuperV1ChecklistAnswer | undefined): boolean {
  return !answer || answer.status !== "confirmed";
}

export function buildPlannerResult(
  questions: SuperV1TemplateQuestion[],
  answers: SuperV1ChecklistAnswer[],
): SuperV1PlannerResult {
  const orderedQuestions = sortTemplateQuestions(questions);
  const answerMap = answerByQuestionId(answers);
  const sections = sectionOrder(orderedQuestions);

  let activeSectionId = sections[sections.length - 1] ?? "completed";
  let nextQuestionId: string | null = null;
  let nextQuestionText: string | null = null;
  let unresolvedRequiredQuestionIds: string[] = [];

  for (const sectionId of sections) {
    const sectionQuestions = orderedQuestions.filter((q) => q.section_id === sectionId);
    const openRequired = sectionQuestions
      .filter((q) => isRequiredOpen(answerMap.get(q.question_id), q))
      .map((q) => q.question_id);
    if (openRequired.length > 0) {
      activeSectionId = sectionId;
      unresolvedRequiredQuestionIds = openRequired;
      const next = sectionQuestions.find((q) => openRequired.includes(q.question_id)) ?? null;
      nextQuestionId = next?.question_id ?? null;
      nextQuestionText = next?.question_text ?? null;
      break;
    }
  }

  return {
    active_section_id: activeSectionId,
    next_question_id: nextQuestionId,
    next_question_text: nextQuestionText,
    ask_count: nextQuestionId ? 1 : 0,
    clarification_required: unresolvedRequiredQuestionIds.some((questionId) => {
      const answer = answerMap.get(questionId);
      return answer?.status === "needs_clarification";
    }),
    unresolved_required_question_ids: unresolvedRequiredQuestionIds,
  };
}

export async function applyValidatedUpdates(params: {
  repo: SuperV1Repository;
  conversationId: string;
  sourceTurnId: string;
  answers: SuperV1ChecklistAnswer[];
  validated: SuperV1ValidatedExtraction;
}): Promise<SuperV1ChecklistAnswer[]> {
  const now = new Date().toISOString();
  const map = answerByQuestionId(params.answers);

  const write = async (next: SuperV1ChecklistAnswer) => {
    map.set(next.question_id, next);
    await params.repo.upsertAnswer(next);
  };

  for (const accepted of params.validated.accepted_updates) {
    const current = map.get(accepted.question_id);
    if (!isQuestionEditable(current)) continue;
    const next: SuperV1ChecklistAnswer = {
      id: current?.id ?? `${params.conversationId}:${accepted.question_id}`,
      conversation_id: params.conversationId,
      question_id: accepted.question_id,
      value_json: accepted.value,
      status: "filled",
      confidence: accepted.confidence,
      evidence_text: accepted.evidence,
      source_turn_id: params.sourceTurnId,
      updated_at: now,
    };
    await write(next);
  }

  for (const ambiguous of params.validated.ambiguous_items) {
    const current = map.get(ambiguous.question_id);
    if (!isQuestionEditable(current)) continue;
    const next: SuperV1ChecklistAnswer = {
      id: current?.id ?? `${params.conversationId}:${ambiguous.question_id}`,
      conversation_id: params.conversationId,
      question_id: ambiguous.question_id,
      value_json: current?.value_json ?? null,
      status: current?.status === "filled" ? "filled" : "needs_clarification",
      confidence: current?.confidence ?? null,
      evidence_text: ambiguous.reason,
      source_turn_id: params.sourceTurnId,
      updated_at: now,
    };
    await write(next);
  }

  return Array.from(map.values());
}

export async function markQuestionsConfirmed(params: {
  repo: SuperV1Repository;
  answers: SuperV1ChecklistAnswer[];
  questionIds: string[];
  sourceTurnId: string;
}): Promise<SuperV1ChecklistAnswer[]> {
  const now = new Date().toISOString();
  const nextAnswers = [...params.answers];
  for (const answer of nextAnswers) {
    if (!params.questionIds.includes(answer.question_id)) continue;
    if (answer.status === "empty") continue;
    const next: SuperV1ChecklistAnswer = {
      ...answer,
      status: "confirmed",
      source_turn_id: params.sourceTurnId,
      updated_at: now,
    };
    await params.repo.upsertAnswer(next);
    const idx = nextAnswers.findIndex((row) => row.question_id === answer.question_id);
    nextAnswers[idx] = next;
  }
  return nextAnswers;
}

export function deriveStateView(params: {
  conversation: SuperV1Conversation;
  questions: SuperV1TemplateQuestion[];
  answers: SuperV1ChecklistAnswer[];
  aiSuggestedDirections?: SuperV1AiSuggestedDirectionsPayload | null;
}): SuperV1StateView {
  const orderedQuestions = sortTemplateQuestions(params.questions);
  const answerMap = answerByQuestionId(params.answers);
  const sections = sectionOrder(orderedQuestions);

  const sectionStats = sections.map((sectionId) => {
    const sectionQuestions = orderedQuestions.filter((q) => q.section_id === sectionId);
    const sectionAnswers = sectionQuestions.map((q) => answerMap.get(q.question_id));
    const filled = sectionAnswers.filter((a) => a?.status === "filled").length;
    const needsClarification = sectionAnswers.filter((a) => a?.status === "needs_clarification").length;
    const confirmed = sectionAnswers.filter((a) => a?.status === "confirmed").length;
    const openRequired = sectionQuestions
      .filter((q) => isRequiredOpen(answerMap.get(q.question_id), q))
      .map((q) => q.question_id);
    return {
      section_id: sectionId,
      total: sectionQuestions.length,
      filled,
      needs_clarification: needsClarification,
      confirmed,
      open_required_question_ids: openRequired,
    };
  });

  const total = orderedQuestions.length;
  const filled = params.answers.filter((a) => a.status === "filled").length;
  const needsClarification = params.answers.filter((a) => a.status === "needs_clarification").length;
  const confirmed = params.answers.filter((a) => a.status === "confirmed").length;

  return {
    conversationId: params.conversation.id,
    templateId: params.conversation.template_id,
    status: params.conversation.status,
    activeSectionId: params.conversation.active_section_id,
    currentQuestionId: params.conversation.current_question_id,
    interaction_mode: params.conversation.interaction_mode ?? "interviewing",
    help_context: params.conversation.help_context_json ?? null,
    completion: {
      total,
      filled,
      needs_clarification: needsClarification,
      confirmed,
      ratio: total > 0 ? (filled + confirmed) / total : 0,
    },
    sections: sectionStats,
    answers: orderedQuestions.map((question) => {
      const answer = answerMap.get(question.question_id);
      return {
        question_id: question.question_id,
        status: answer?.status ?? "empty",
        value: answer?.value_json ?? null,
        confidence: answer?.confidence ?? null,
        evidence_text: answer?.evidence_text ?? null,
      };
    }),
    ai_suggested_directions: params.aiSuggestedDirections ?? null,
  };
}

export function summarizeAcceptedFacts(items: SuperV1ExtractionItem[]): string[] {
  return items
    .map((item) => {
      const value = typeof item.value === "string" ? item.value : JSON.stringify(item.value);
      return `${item.question_id}: ${value}`;
    })
    .slice(0, 3);
}
