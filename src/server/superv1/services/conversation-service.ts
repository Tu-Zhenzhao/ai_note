import { randomUUID } from "crypto";
import { getInterviewRepository } from "@/server/repo";
import { getSuperV1Repository } from "@/server/superv1/repo";
import { buildDefaultSuperV1Template, SUPERV1_TEMPLATE_ID } from "@/server/superv1/template";
import { buildPlannerResult, deriveStateView } from "@/server/superv1/services/checklist-state-service";

async function ensureLegacySessionForChatBook(conversationId: string, now: string) {
  const repo = getInterviewRepository();
  try {
    const existing = await repo.getSession(conversationId);
    if (existing) return;
    await repo.createSession({
      id: conversationId,
      user_id: "superv1_user",
      status: "opening",
      current_module: "company_profile",
      current_question_id: "cp_what_does_company_do",
      completion_level: "incomplete",
      completion_score: 0,
      model_primary: process.env.MODEL_PRIMARY ?? "gemini-3.1-flash-lite-preview",
      model_fallback: process.env.MODEL_FALLBACK ?? "deepseek-chat",
      state_schema_version: "superv1",
      created_at: now,
      updated_at: now,
    });
  } catch {
    // Legacy compatibility is best-effort.
  }
}

export async function startSuperV1Conversation(): Promise<{
  conversationId: string;
  state: ReturnType<typeof deriveStateView>;
}> {
  const repo = getSuperV1Repository();
  const template = buildDefaultSuperV1Template(SUPERV1_TEMPLATE_ID);
  await repo.ensureTemplate(SUPERV1_TEMPLATE_ID, template);

  const now = new Date().toISOString();
  const conversationId = randomUUID();
  const initialQuestion = template.find((question) => question.is_required) ?? template[0] ?? null;
  const activeSectionId = initialQuestion?.section_id ?? "company_understanding";
  await repo.createConversation({
    id: conversationId,
    template_id: SUPERV1_TEMPLATE_ID,
    status: "active",
    active_section_id: activeSectionId,
    current_question_id: initialQuestion?.question_id ?? null,
    created_at: now,
    updated_at: now,
  });

  await repo.ensureChecklistAnswers(conversationId, SUPERV1_TEMPLATE_ID);
  const answers = await repo.listAnswers(conversationId);
  const planner = buildPlannerResult(template, answers);
  const conversation = {
    id: conversationId,
    template_id: SUPERV1_TEMPLATE_ID,
    status: "active" as const,
    active_section_id: planner.active_section_id,
    current_question_id: planner.next_question_id,
    created_at: now,
    updated_at: now,
  };
  await repo.updateConversation(conversation);
  await ensureLegacySessionForChatBook(conversationId, now);

  const state = deriveStateView({
    conversation,
    questions: template,
    answers,
    aiSuggestedDirections: null,
  });
  return { conversationId, state };
}

export async function getSuperV1ConversationState(conversationId: string) {
  const repo = getSuperV1Repository();
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) return null;
  const [questions, answers] = await Promise.all([
    repo.listTemplateQuestions(conversation.template_id),
    repo.listAnswers(conversationId),
  ]);
  const directions = await repo.getAiSuggestedDirections(conversationId);
  return deriveStateView({
    conversation,
    questions,
    answers,
    aiSuggestedDirections: directions?.payload_json ?? null,
  });
}

export async function getSuperV1ConversationTurns(conversationId: string) {
  const repo = getSuperV1Repository();
  return repo.listTurns(conversationId, 200);
}

export async function getSuperV1ConversationAudit(conversationId: string) {
  const repo = getSuperV1Repository();
  const [conversation, turns, extractionEvents, plannerEvents] = await Promise.all([
    repo.getConversation(conversationId),
    repo.listTurns(conversationId, 200),
    repo.listExtractionEvents(conversationId, 200),
    repo.listPlannerEvents(conversationId, 200),
  ]);
  if (!conversation) return null;
  return {
    conversation,
    turns,
    extraction_events: extractionEvents,
    planner_events: plannerEvents,
  };
}

export async function listSuperV1Conversations(limit = 50) {
  const repo = getSuperV1Repository();
  return repo.listConversations(limit);
}

export async function deleteSuperV1Conversation(conversationId: string) {
  const repo = getSuperV1Repository();
  await repo.deleteConversation(conversationId);

  // Keep legacy mirror cleanup best-effort for operators who inspect both stores.
  try {
    await getInterviewRepository().deleteSession(conversationId);
  } catch {
    // ignore legacy cleanup errors
  }
}
