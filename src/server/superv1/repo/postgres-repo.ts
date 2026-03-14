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
import { getPool } from "@/server/repo/db";

function toJsonbParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class PostgresSuperV1Repository implements SuperV1Repository {
  private pool = getPool();

  private ensurePool() {
    if (!this.pool) {
      throw new Error("DATABASE_URL not configured");
    }
    return this.pool;
  }

  async ensureTemplate(templateId: string, questions: SuperV1TemplateQuestion[]): Promise<void> {
    const pool = this.ensurePool();
    const existing = await pool.query(
      "select 1 from checklist_templates where template_id = $1 limit 1",
      [templateId],
    );
    if (existing.rowCount && existing.rowCount > 0) return;

    for (const question of questions) {
      await pool.query(
        `insert into checklist_templates
         (id, template_id, section_id, question_id, question_text, question_description, field_type, is_required, display_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (template_id, question_id) do nothing`,
        [
          question.id,
          question.template_id,
          question.section_id,
          question.question_id,
          question.question_text,
          question.question_description,
          question.field_type,
          question.is_required,
          question.display_order,
        ],
      );
    }
  }

  async createConversation(conversation: SuperV1Conversation): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into conversations
       (id, template_id, status, active_section_id, current_question_id, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        conversation.id,
        conversation.template_id,
        conversation.status,
        conversation.active_section_id,
        conversation.current_question_id,
        conversation.created_at,
        conversation.updated_at,
      ],
    );
  }

  async getConversation(conversationId: string): Promise<SuperV1Conversation | null> {
    const pool = this.ensurePool();
    const result = await pool.query("select * from conversations where id = $1", [conversationId]);
    return (result.rows[0] as SuperV1Conversation | undefined) ?? null;
  }

  async updateConversation(conversation: SuperV1Conversation): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `update conversations
       set template_id = $2,
           status = $3,
           active_section_id = $4,
           current_question_id = $5,
           updated_at = $6
       where id = $1`,
      [
        conversation.id,
        conversation.template_id,
        conversation.status,
        conversation.active_section_id,
        conversation.current_question_id,
        conversation.updated_at,
      ],
    );
  }

  async listConversations(limit = 50): Promise<SuperV1Conversation[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select * from conversations order by updated_at desc limit $1",
      [limit],
    );
    return result.rows as SuperV1Conversation[];
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query("delete from conversations where id = $1", [conversationId]);
  }

  async ensureChecklistAnswers(conversationId: string, templateId: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into checklist_answers
       (id, conversation_id, question_id, value_json, status, confidence, evidence_text, source_turn_id, updated_at)
       select md5($1 || ':' || t.question_id), $1, t.question_id, null, 'empty', null, null, null, now()
       from checklist_templates t
       where t.template_id = $2
       on conflict (conversation_id, question_id) do nothing`,
      [conversationId, templateId],
    );
  }

  async listAnswers(conversationId: string): Promise<SuperV1ChecklistAnswer[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select * from checklist_answers where conversation_id = $1 order by updated_at asc",
      [conversationId],
    );
    return result.rows as SuperV1ChecklistAnswer[];
  }

  async upsertAnswer(answer: SuperV1ChecklistAnswer): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into checklist_answers
       (id, conversation_id, question_id, value_json, status, confidence, evidence_text, source_turn_id, updated_at)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
       on conflict (conversation_id, question_id)
       do update set
         value_json = excluded.value_json,
         status = excluded.status,
         confidence = excluded.confidence,
         evidence_text = excluded.evidence_text,
         source_turn_id = excluded.source_turn_id,
         updated_at = excluded.updated_at`,
      [
        answer.id,
        answer.conversation_id,
        answer.question_id,
        toJsonbParam(answer.value_json),
        answer.status,
        answer.confidence,
        answer.evidence_text,
        answer.source_turn_id,
        answer.updated_at,
      ],
    );
  }

  async listTemplateQuestions(templateId: string): Promise<SuperV1TemplateQuestion[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select * from checklist_templates where template_id = $1 order by display_order asc",
      [templateId],
    );
    return result.rows as SuperV1TemplateQuestion[];
  }

  async addTurn(turn: SuperV1Turn): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into turns (id, conversation_id, role, message_text, created_at)
       values ($1,$2,$3,$4,$5)`,
      [turn.id, turn.conversation_id, turn.role, turn.message_text, turn.created_at],
    );
  }

  async listTurns(conversationId: string, limit?: number): Promise<SuperV1Turn[]> {
    const pool = this.ensurePool();
    if (limit) {
      const result = await pool.query(
        `select * from (
           select * from turns where conversation_id = $1 order by created_at desc limit $2
         ) as t order by created_at asc`,
        [conversationId, limit],
      );
      return result.rows as SuperV1Turn[];
    }
    const result = await pool.query(
      "select * from turns where conversation_id = $1 order by created_at asc",
      [conversationId],
    );
    return result.rows as SuperV1Turn[];
  }

  async addExtractionEvent(event: SuperV1ExtractionEvent): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into extraction_events
       (id, turn_id, raw_extraction_json, accepted_updates_json, rejected_updates_json, created_at)
       values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6)`,
      [
        event.id,
        event.turn_id,
        toJsonbParam(event.raw_extraction_json),
        toJsonbParam(event.accepted_updates_json),
        toJsonbParam(event.rejected_updates_json),
        event.created_at,
      ],
    );
  }

  async listExtractionEvents(conversationId: string, limit = 100): Promise<SuperV1ExtractionEvent[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `select e.*, t.conversation_id
       from extraction_events e
       join turns t on t.id = e.turn_id
       where t.conversation_id = $1
       order by e.created_at desc
       limit $2`,
      [conversationId, limit],
    );
    return (result.rows as SuperV1ExtractionEvent[]).reverse();
  }

  async addPlannerEvent(event: SuperV1PlannerEvent): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into planner_events (id, turn_id, planner_result_json, created_at)
       values ($1,$2,$3::jsonb,$4)`,
      [event.id, event.turn_id, toJsonbParam(event.planner_result_json), event.created_at],
    );
  }

  async listPlannerEvents(conversationId: string, limit = 100): Promise<SuperV1PlannerEvent[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `select p.*, t.conversation_id
       from planner_events p
       join turns t on t.id = p.turn_id
       where t.conversation_id = $1
       order by p.created_at desc
       limit $2`,
      [conversationId, limit],
    );
    return (result.rows as SuperV1PlannerEvent[]).reverse();
  }

  async getAiSuggestedDirections(conversationId: string): Promise<SuperV1AiDirectionsRecord | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select * from ai_suggested_directions where conversation_id = $1",
      [conversationId],
    );
    return (result.rows[0] as SuperV1AiDirectionsRecord | undefined) ?? null;
  }

  async upsertAiSuggestedDirections(record: SuperV1AiDirectionsRecord): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into ai_suggested_directions
       (conversation_id, language, payload_json, source_turn_id, source_answers_updated_at, created_at, updated_at)
       values ($1,$2,$3::jsonb,$4,$5,$6,$7)
       on conflict (conversation_id)
       do update set
         language = excluded.language,
         payload_json = excluded.payload_json,
         source_turn_id = excluded.source_turn_id,
         source_answers_updated_at = excluded.source_answers_updated_at,
         updated_at = excluded.updated_at`,
      [
        record.conversation_id,
        record.language,
        toJsonbParam(record.payload_json),
        record.source_turn_id,
        record.source_answers_updated_at,
        record.created_at,
        record.updated_at,
      ],
    );
  }
}
