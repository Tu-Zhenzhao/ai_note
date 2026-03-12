import {
  SuperV1ChecklistAnswer,
  SuperV1Conversation,
  SuperV1ExtractionEvent,
  SuperV1PlannerEvent,
  SuperV1TemplateQuestion,
  SuperV1Turn,
} from "@/server/superv1/types";

export interface SuperV1Repository {
  ensureTemplate(templateId: string, questions: SuperV1TemplateQuestion[]): Promise<void>;

  createConversation(conversation: SuperV1Conversation): Promise<void>;
  getConversation(conversationId: string): Promise<SuperV1Conversation | null>;
  updateConversation(conversation: SuperV1Conversation): Promise<void>;
  listConversations(limit?: number): Promise<SuperV1Conversation[]>;
  deleteConversation(conversationId: string): Promise<void>;

  ensureChecklistAnswers(conversationId: string, templateId: string): Promise<void>;
  listAnswers(conversationId: string): Promise<SuperV1ChecklistAnswer[]>;
  upsertAnswer(answer: SuperV1ChecklistAnswer): Promise<void>;

  listTemplateQuestions(templateId: string): Promise<SuperV1TemplateQuestion[]>;

  addTurn(turn: SuperV1Turn): Promise<void>;
  listTurns(conversationId: string, limit?: number): Promise<SuperV1Turn[]>;

  addExtractionEvent(event: SuperV1ExtractionEvent): Promise<void>;
  listExtractionEvents(conversationId: string, limit?: number): Promise<SuperV1ExtractionEvent[]>;

  addPlannerEvent(event: SuperV1PlannerEvent): Promise<void>;
  listPlannerEvents(conversationId: string, limit?: number): Promise<SuperV1PlannerEvent[]>;
}
