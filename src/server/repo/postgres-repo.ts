import {
  ChatBookEntry,
  CheckpointSnapshot,
  GeneratedBrief,
  GeneratedContent,
  HandoffSummary,
  InterviewMessage,
  InterviewSession,
  PayloadPatchLog,
  PlannerDecision,
  SessionTrace,
  ToolActionLog,
} from "@/lib/types";
import { InterviewRepository, InterviewStateRecord, SessionSummary } from "@/server/repo/contracts";
import { getPool } from "@/server/repo/db";

export class PostgresInterviewRepository implements InterviewRepository {
  private pool = getPool();

  private ensurePool() {
    if (!this.pool) {
      throw new Error("DATABASE_URL not configured");
    }
    return this.pool;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select id, status, completion_level, completion_score, created_at, updated_at from interview_sessions order by updated_at desc",
    );
    return result.rows as SessionSummary[];
  }

  async getSession(sessionId: string): Promise<InterviewSession | null> {
    const pool = this.ensurePool();
    const result = await pool.query("select * from interview_sessions where id = $1", [sessionId]);
    return (result.rows[0] as InterviewSession | undefined) ?? null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query("delete from checkpoint_snapshots where session_id = $1", [sessionId]);
    await pool.query("delete from tool_action_log where session_id = $1", [sessionId]);
    await pool.query("delete from payload_patch_log where session_id = $1", [sessionId]);
    await pool.query("delete from planner_decisions where session_id = $1", [sessionId]);
    await pool.query("delete from chat_book_entries where session_id = $1", [sessionId]);
    await pool.query("delete from interview_messages where session_id = $1", [sessionId]);
    await pool.query("delete from generated_contents where session_id = $1", [sessionId]);
    await pool.query("delete from generated_briefs where session_id = $1", [sessionId]);
    await pool.query("delete from handoff_summaries where session_id = $1", [sessionId]);
    await pool.query("delete from interview_state where session_id = $1", [sessionId]);
    await pool.query("delete from interview_sessions where id = $1", [sessionId]);
  }

  async createSession(session: InterviewSession): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into interview_sessions
       (id, user_id, status, current_module, current_question_id, completion_level, completion_score, model_primary, model_fallback, state_schema_version, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        session.id,
        session.user_id,
        session.status,
        session.current_module,
        session.current_question_id,
        session.completion_level,
        session.completion_score,
        session.model_primary,
        session.model_fallback,
        session.state_schema_version ?? "3",
        session.created_at,
        session.updated_at,
      ],
    );
  }

  async upsertSession(session: InterviewSession): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into interview_sessions
       (id, user_id, status, current_module, current_question_id, completion_level, completion_score, model_primary, model_fallback, state_schema_version, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id)
       do update set
         status = excluded.status,
         current_module = excluded.current_module,
         current_question_id = excluded.current_question_id,
         completion_level = excluded.completion_level,
         completion_score = excluded.completion_score,
         model_primary = excluded.model_primary,
         model_fallback = excluded.model_fallback,
         state_schema_version = excluded.state_schema_version,
         updated_at = excluded.updated_at`,
      [
        session.id,
        session.user_id,
        session.status,
        session.current_module,
        session.current_question_id,
        session.completion_level,
        session.completion_score,
        session.model_primary,
        session.model_fallback,
        session.state_schema_version ?? "3",
        session.created_at,
        session.updated_at,
      ],
    );
  }

  async getState(sessionId: string): Promise<InterviewStateRecord | null> {
    const pool = this.ensurePool();
    const result = await pool.query("select * from interview_state where session_id = $1", [sessionId]);
    return (result.rows[0] as InterviewStateRecord | undefined) ?? null;
  }

  async upsertState(record: InterviewStateRecord): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into interview_state (session_id, state_jsonb, preview_jsonb, assessment_jsonb, last_checkpoint_at)
       values ($1, $2, $3, $4, $5)
       on conflict (session_id)
       do update set
         state_jsonb = excluded.state_jsonb,
         preview_jsonb = excluded.preview_jsonb,
         assessment_jsonb = excluded.assessment_jsonb,
         last_checkpoint_at = excluded.last_checkpoint_at`,
      [record.session_id, record.state_jsonb, record.preview_jsonb, record.assessment_jsonb, record.last_checkpoint_at],
    );
  }

  async listMessages(sessionId: string): Promise<InterviewMessage[]> {
    const pool = this.ensurePool();
    const result = await pool.query("select * from interview_messages where session_id = $1 order by created_at asc", [sessionId]);
    return result.rows as InterviewMessage[];
  }

  async addMessage(message: InterviewMessage): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      "insert into interview_messages (id, session_id, role, content, created_at) values ($1,$2,$3,$4,$5)",
      [message.id, message.session_id, message.role, message.content, message.created_at],
    );
  }

  async addBrief(brief: GeneratedBrief): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      "insert into generated_briefs (id, session_id, format, brief_jsonb, approved, created_at) values ($1,$2,$3,$4,$5,$6)",
      [brief.id, brief.session_id, brief.format, brief.brief_jsonb, brief.approved, brief.created_at],
    );
  }

  async getBrief(briefId: string): Promise<GeneratedBrief | null> {
    const pool = this.ensurePool();
    const result = await pool.query("select * from generated_briefs where id = $1", [briefId]);
    return (result.rows[0] as GeneratedBrief | undefined) ?? null;
  }

  async addGeneratedContent(content: GeneratedContent): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      "insert into generated_contents (id, session_id, brief_id, format, content_jsonb, created_at) values ($1,$2,$3,$4,$5,$6)",
      [content.id, content.session_id, content.brief_id, content.format, content.content_jsonb, content.created_at],
    );
  }

  async addHandoffSummary(summary: HandoffSummary): Promise<void> {
    const pool = this.ensurePool();
    await pool.query("insert into handoff_summaries (id, session_id, summary_jsonb, created_at) values ($1,$2,$3,$4)", [
      summary.id,
      summary.session_id,
      summary.summary_jsonb,
      summary.created_at,
    ]);
  }

  async addChatBookEntry(entry: ChatBookEntry): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into chat_book_entries
       (id, session_id, entry_type, text, module, confidence, status, source_turn_ids, metadata_json, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        entry.id,
        entry.session_id,
        entry.entry_type,
        entry.text,
        entry.module,
        entry.confidence,
        entry.status,
        entry.source_turn_ids,
        entry.metadata_json,
        entry.created_at,
      ],
    );
  }

  async listChatBookEntries(sessionId: string, limit = 50): Promise<ChatBookEntry[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select * from chat_book_entries where session_id = $1 order by created_at desc limit $2",
      [sessionId, limit],
    );
    return (result.rows as ChatBookEntry[]).reverse();
  }

  async addPlannerDecision(decision: PlannerDecision): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into planner_decisions
       (id, session_id, turn_id, chosen_action, question_style, rationale, target_fields, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        decision.id,
        decision.session_id,
        decision.turn_id,
        decision.chosen_action,
        decision.question_style,
        decision.rationale,
        decision.target_fields,
        decision.created_at,
      ],
    );
  }

  async listPlannerDecisions(sessionId: string, limit = 100): Promise<PlannerDecision[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select * from planner_decisions where session_id = $1 order by created_at desc limit $2",
      [sessionId, limit],
    );
    return (result.rows as PlannerDecision[]).reverse();
  }

  async addPayloadPatchLog(log: PayloadPatchLog): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into payload_patch_log
       (id, session_id, turn_id, patch_json, applied_by_tool, created_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [log.id, log.session_id, log.turn_id, log.patch_json, log.applied_by_tool, log.created_at],
    );
  }

  async listPayloadPatchLogs(sessionId: string, limit = 100): Promise<PayloadPatchLog[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select * from payload_patch_log where session_id = $1 order by created_at desc limit $2",
      [sessionId, limit],
    );
    return (result.rows as PayloadPatchLog[]).reverse();
  }

  async addToolActionLog(log: ToolActionLog): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into tool_action_log
       (id, session_id, turn_id, tool_name, input_json, output_json, success, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [log.id, log.session_id, log.turn_id, log.tool_name, log.input_json, log.output_json, log.success, log.created_at],
    );
  }

  async listToolActionLogs(sessionId: string, limit = 200): Promise<ToolActionLog[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select * from tool_action_log where session_id = $1 order by created_at desc limit $2",
      [sessionId, limit],
    );
    return (result.rows as ToolActionLog[]).reverse();
  }

  async addCheckpointSnapshot(snapshot: CheckpointSnapshot): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into checkpoint_snapshots
       (id, session_id, snapshot_json, user_confirmed, created_at)
       values ($1,$2,$3,$4,$5)`,
      [snapshot.id, snapshot.session_id, snapshot.snapshot_json, snapshot.user_confirmed, snapshot.created_at],
    );
  }

  async listCheckpointSnapshots(sessionId: string, limit = 50): Promise<CheckpointSnapshot[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "select * from checkpoint_snapshots where session_id = $1 order by created_at desc limit $2",
      [sessionId, limit],
    );
    return (result.rows as CheckpointSnapshot[]).reverse();
  }

  async getSessionTrace(sessionId: string, limit = 200): Promise<SessionTrace> {
    const [planner_decisions, tool_action_log, payload_patch_log, checkpoint_snapshots] = await Promise.all([
      this.listPlannerDecisions(sessionId, limit),
      this.listToolActionLogs(sessionId, limit),
      this.listPayloadPatchLogs(sessionId, limit),
      this.listCheckpointSnapshots(sessionId, Math.min(limit, 50)),
    ]);
    return {
      session_id: sessionId,
      planner_decisions,
      tool_action_log,
      payload_patch_log,
      checkpoint_snapshots,
    };
  }
}
