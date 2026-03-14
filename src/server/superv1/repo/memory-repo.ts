import {
  SuperV1AiDirectionsRecord,
  SuperV1ChecklistAnswer,
  SuperV1Conversation,
  SuperV1ExtractionEvent,
  SuperV1PlannerEvent,
  SuperV1TemplateQuestion,
  SuperV1Turn,
} from "@/server/superv1/types";
import { SuperV1Repository } from "@/server/superv1/repo/contracts";

interface SuperV1Store {
  conversations: Map<string, SuperV1Conversation>;
  templateQuestions: Map<string, SuperV1TemplateQuestion[]>;
  answers: Map<string, SuperV1ChecklistAnswer[]>;
  turns: Map<string, SuperV1Turn[]>;
  extractionEvents: Map<string, SuperV1ExtractionEvent[]>;
  plannerEvents: Map<string, SuperV1PlannerEvent[]>;
  aiDirections: Map<string, SuperV1AiDirectionsRecord>;
}

const globalStore = globalThis as unknown as { __superv1Store?: SuperV1Store };

function getStore(): SuperV1Store {
  if (!globalStore.__superv1Store) {
    globalStore.__superv1Store = {
      conversations: new Map(),
      templateQuestions: new Map(),
      answers: new Map(),
      turns: new Map(),
      extractionEvents: new Map(),
      plannerEvents: new Map(),
      aiDirections: new Map(),
    };
  }
  return globalStore.__superv1Store;
}

function pushCapped<T>(items: T[], entry: T, cap: number): void {
  items.push(entry);
  if (items.length > cap) {
    items.splice(0, items.length - cap);
  }
}

export class MemorySuperV1Repository implements SuperV1Repository {
  private readonly store = getStore();

  async ensureTemplate(templateId: string, questions: SuperV1TemplateQuestion[]): Promise<void> {
    if (!this.store.templateQuestions.has(templateId)) {
      this.store.templateQuestions.set(templateId, questions);
    }
  }

  async createConversation(conversation: SuperV1Conversation): Promise<void> {
    this.store.conversations.set(conversation.id, conversation);
  }

  async getConversation(conversationId: string): Promise<SuperV1Conversation | null> {
    return this.store.conversations.get(conversationId) ?? null;
  }

  async updateConversation(conversation: SuperV1Conversation): Promise<void> {
    this.store.conversations.set(conversation.id, conversation);
  }

  async listConversations(limit = 50): Promise<SuperV1Conversation[]> {
    return Array.from(this.store.conversations.values())
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.store.conversations.delete(conversationId);
    this.store.answers.delete(conversationId);
    this.store.turns.delete(conversationId);
    this.store.extractionEvents.delete(conversationId);
    this.store.plannerEvents.delete(conversationId);
    this.store.aiDirections.delete(conversationId);
  }

  async ensureChecklistAnswers(conversationId: string, templateId: string): Promise<void> {
    const existing = this.store.answers.get(conversationId) ?? [];
    const existingIds = new Set(existing.map((entry) => entry.question_id));
    const template = this.store.templateQuestions.get(templateId) ?? [];
    const now = new Date().toISOString();

    for (const question of template) {
      if (existingIds.has(question.question_id)) continue;
      existing.push({
        id: `${conversationId}:${question.question_id}`,
        conversation_id: conversationId,
        question_id: question.question_id,
        value_json: null,
        status: "empty",
        confidence: null,
        evidence_text: null,
        source_turn_id: null,
        updated_at: now,
      });
    }
    this.store.answers.set(conversationId, existing);
  }

  async listAnswers(conversationId: string): Promise<SuperV1ChecklistAnswer[]> {
    return (this.store.answers.get(conversationId) ?? []).slice();
  }

  async upsertAnswer(answer: SuperV1ChecklistAnswer): Promise<void> {
    const answers = this.store.answers.get(answer.conversation_id) ?? [];
    const idx = answers.findIndex((entry) => entry.question_id === answer.question_id);
    if (idx >= 0) {
      answers[idx] = answer;
    } else {
      answers.push(answer);
    }
    this.store.answers.set(answer.conversation_id, answers);
  }

  async listTemplateQuestions(templateId: string): Promise<SuperV1TemplateQuestion[]> {
    return (this.store.templateQuestions.get(templateId) ?? []).slice();
  }

  async addTurn(turn: SuperV1Turn): Promise<void> {
    const turns = this.store.turns.get(turn.conversation_id) ?? [];
    pushCapped(turns, turn, 500);
    this.store.turns.set(turn.conversation_id, turns);
  }

  async listTurns(conversationId: string, limit?: number): Promise<SuperV1Turn[]> {
    const turns = this.store.turns.get(conversationId) ?? [];
    return limit ? turns.slice(-limit) : turns.slice();
  }

  async addExtractionEvent(event: SuperV1ExtractionEvent): Promise<void> {
    const events = this.store.extractionEvents.get(event.conversation_id) ?? [];
    pushCapped(events, event, 300);
    this.store.extractionEvents.set(event.conversation_id, events);
  }

  async listExtractionEvents(conversationId: string, limit = 100): Promise<SuperV1ExtractionEvent[]> {
    const events = this.store.extractionEvents.get(conversationId) ?? [];
    return events.slice(-limit);
  }

  async addPlannerEvent(event: SuperV1PlannerEvent): Promise<void> {
    const events = this.store.plannerEvents.get(event.conversation_id) ?? [];
    pushCapped(events, event, 300);
    this.store.plannerEvents.set(event.conversation_id, events);
  }

  async listPlannerEvents(conversationId: string, limit = 100): Promise<SuperV1PlannerEvent[]> {
    const events = this.store.plannerEvents.get(conversationId) ?? [];
    return events.slice(-limit);
  }

  async getAiSuggestedDirections(conversationId: string): Promise<SuperV1AiDirectionsRecord | null> {
    return this.store.aiDirections.get(conversationId) ?? null;
  }

  async upsertAiSuggestedDirections(record: SuperV1AiDirectionsRecord): Promise<void> {
    this.store.aiDirections.set(record.conversation_id, record);
  }
}
