import {
  AskmoreV2EventChannel,
  AskmoreV2FlowVersion,
  AskmoreV2InsightRunRecord,
  AskmoreV2Message,
  AskmoreV2Session,
  AskmoreV2SessionFeedback,
  AskmoreV2TurnCommitRecord,
  AskmoreV2TurnEvent,
  AskmoreV2VisibleEvent,
} from "@/server/askmore_v2/types";
import { AskmoreV2Repository } from "@/server/askmore_v2/repo/contracts";
import { dbQuery, getActiveDbExecutor } from "@/server/repo/db";
import { DEFAULT_WORKSPACE_ID } from "@/server/auth/constants";

function toJsonbParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function ensureDb() {
  const db = getActiveDbExecutor();
  if (!db) {
    throw new Error("DATABASE_URL not configured");
  }
  return db;
}

function resolveWorkspaceId(workspaceId?: string): string {
  const normalized = workspaceId?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_ID;
}

export class PostgresAskmoreV2Repository implements AskmoreV2Repository {
  async createFlowVersion(flow: AskmoreV2FlowVersion): Promise<void> {
    ensureDb();
    const workspaceId = resolveWorkspaceId(flow.workspace_id);
    await dbQuery(
      `insert into askmore_v2_flow_versions
       (id, version, workspace_id, status, flow_jsonb, published_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [
        flow.id,
        flow.version,
        workspaceId,
        flow.status,
        toJsonbParam(flow.flow_jsonb),
        flow.published_at,
        flow.created_at,
        flow.updated_at,
      ],
    );
    flow.workspace_id = workspaceId;
  }

  async listFlowVersions(limit = 50, workspaceId?: string): Promise<AskmoreV2FlowVersion[]> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    const result = await dbQuery(
      `select *
       from askmore_v2_flow_versions
       where workspace_id = $2
       order by version desc
       limit $1`,
      [limit, scopeWorkspaceId],
    );
    return result.rows as AskmoreV2FlowVersion[];
  }

  async getFlowVersion(flowVersionId: string, workspaceId?: string): Promise<AskmoreV2FlowVersion | null> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    const result = await dbQuery(
      `select *
       from askmore_v2_flow_versions
       where id = $1 and workspace_id = $2`,
      [flowVersionId, scopeWorkspaceId],
    );
    return (result.rows[0] as AskmoreV2FlowVersion | undefined) ?? null;
  }

  async getActiveFlowVersion(workspaceId?: string): Promise<AskmoreV2FlowVersion | null> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    const result = await dbQuery(
      `select *
       from askmore_v2_flow_versions
       where workspace_id = $1 and status = 'published'
       order by version desc
       limit 1`,
      [scopeWorkspaceId],
    );
    return (result.rows[0] as AskmoreV2FlowVersion | undefined) ?? null;
  }

  async clearPublishedFlowVersions(workspaceId?: string): Promise<void> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    await dbQuery(
      `update askmore_v2_flow_versions
       set status = 'draft',
           published_at = null,
           updated_at = now()
       where workspace_id = $1 and status = 'published'`,
      [scopeWorkspaceId],
    );
  }

  async createSession(session: AskmoreV2Session): Promise<void> {
    ensureDb();
    const workspaceId = resolveWorkspaceId(session.workspace_id);
    await dbQuery(
      `insert into askmore_v2_sessions
       (id, flow_version_id, workspace_id, created_by_user_id, status, turn_count, state_version, state_jsonb, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [
        session.id,
        session.flow_version_id,
        workspaceId,
        session.created_by_user_id ?? null,
        session.status,
        session.turn_count,
        session.state_version > 0 ? session.state_version : 1,
        toJsonbParam(session.state_jsonb),
        session.created_at,
        session.updated_at,
      ],
    );
    session.workspace_id = workspaceId;
  }

  async getSession(sessionId: string, workspaceId?: string): Promise<AskmoreV2Session | null> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    const result = await dbQuery(
      `select *
       from askmore_v2_sessions
       where id = $1 and workspace_id = $2`,
      [sessionId, scopeWorkspaceId],
    );
    const row = result.rows[0] as AskmoreV2Session | undefined;
    if (!row) return null;
    if (typeof row.state_version !== "number") {
      row.state_version = 1;
    }
    return row;
  }

  async listSessions(limit = 100, workspaceId?: string): Promise<AskmoreV2Session[]> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    const result = await dbQuery(
      `select *
       from askmore_v2_sessions
       where workspace_id = $2
       order by updated_at desc
       limit $1`,
      [limit, scopeWorkspaceId],
    );
    return (result.rows as AskmoreV2Session[]).map((row) => ({
      ...row,
      state_version: typeof row.state_version === "number" ? row.state_version : 1,
    }));
  }

  async deleteSession(sessionId: string, workspaceId?: string): Promise<boolean> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    const result = await dbQuery(
      `delete from askmore_v2_sessions
       where id = $1 and workspace_id = $2`,
      [sessionId, scopeWorkspaceId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateSession(session: AskmoreV2Session): Promise<void> {
    ensureDb();
    const currentVersion = typeof session.state_version === "number" ? session.state_version : 1;
    const workspaceId = resolveWorkspaceId(session.workspace_id);
    const result = await dbQuery(
      `update askmore_v2_sessions
       set flow_version_id = $2,
           workspace_id = $3,
           created_by_user_id = $4,
           status = $5,
           turn_count = $6,
           state_version = state_version + 1,
           state_jsonb = $7::jsonb,
           updated_at = $8
       where id = $1 and workspace_id = $9 and state_version = $10`,
      [
        session.id,
        session.flow_version_id,
        workspaceId,
        session.created_by_user_id ?? null,
        session.status,
        session.turn_count,
        toJsonbParam(session.state_jsonb),
        session.updated_at,
        workspaceId,
        currentVersion,
      ],
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new Error("ASKMORE_V2_STATE_VERSION_CONFLICT");
    }

    session.state_version = currentVersion + 1;
  }

  async addMessage(message: AskmoreV2Message): Promise<void> {
    ensureDb();
    await dbQuery(
      `insert into askmore_v2_messages
       (id, session_id, role, message_text, created_at)
       values ($1,$2,$3,$4,$5)`,
      [
        message.id,
        message.session_id,
        message.role,
        message.message_text,
        message.created_at,
      ],
    );
  }

  async listMessages(sessionId: string, limit?: number): Promise<AskmoreV2Message[]> {
    ensureDb();
    if (!limit) {
      const result = await dbQuery(
        `select *
         from askmore_v2_messages
         where session_id = $1
         order by created_at asc`,
        [sessionId],
      );
      return result.rows as AskmoreV2Message[];
    }

    const result = await dbQuery(
      `select * from (
         select *
         from askmore_v2_messages
         where session_id = $1
         order by created_at desc
         limit $2
       ) as t
       order by created_at asc`,
      [sessionId, limit],
    );
    return result.rows as AskmoreV2Message[];
  }

  async upsertSessionFeedback(feedback: AskmoreV2SessionFeedback): Promise<void> {
    ensureDb();
    const workspaceId = resolveWorkspaceId(feedback.workspace_id);
    await dbQuery(
      `insert into askmore_v2_session_feedback
       (id, session_id, workspace_id, user_id, helpful, satisfaction_score, goal_text, issue_text, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (session_id)
       do update set
         helpful = excluded.helpful,
         satisfaction_score = excluded.satisfaction_score,
         goal_text = excluded.goal_text,
         issue_text = excluded.issue_text,
         updated_at = excluded.updated_at`,
      [
        feedback.id,
        feedback.session_id,
        workspaceId,
        feedback.user_id,
        feedback.helpful,
        feedback.satisfaction_score,
        feedback.goal_text,
        feedback.issue_text,
        feedback.created_at,
        feedback.updated_at,
      ],
    );
  }

  async getSessionFeedback(sessionId: string, workspaceId?: string): Promise<AskmoreV2SessionFeedback | null> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    const result = await dbQuery(
      `select f.*
       from askmore_v2_session_feedback f
       join askmore_v2_sessions s on s.id = f.session_id
       where f.session_id = $1 and s.workspace_id = $2
       limit 1`,
      [sessionId, scopeWorkspaceId],
    );
    return (result.rows[0] as AskmoreV2SessionFeedback | undefined) ?? null;
  }

  async addTurnEvents(params: {
    session_id: string;
    turn_id: string;
    channel: AskmoreV2EventChannel;
    events: AskmoreV2TurnEvent[];
  }): Promise<void> {
    ensureDb();
    for (const [index, event] of params.events.entries()) {
      await dbQuery(
        `insert into askmore_v2_turn_events
         (id, session_id, turn_id, event_channel, event_order, event_type, payload_jsonb, visible, created_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [
          event.event_id,
          params.session_id,
          params.turn_id,
          params.channel,
          index,
          event.event_type,
          toJsonbParam(event.payload),
          event.visible,
          event.created_at,
        ],
      );
    }
  }

  async listTurnEvents(
    sessionId: string,
    turnId?: string,
    channel: AskmoreV2EventChannel = "visible",
  ): Promise<AskmoreV2TurnEvent[]> {
    ensureDb();
    const result = turnId
      ? await dbQuery(
          `select *
           from askmore_v2_turn_events
           where session_id = $1 and turn_id = $2 and event_channel = $3
           order by event_order asc`,
          [sessionId, turnId, channel],
        )
      : await dbQuery(
          `select *
           from askmore_v2_turn_events
           where session_id = $1 and event_channel = $2
           order by created_at asc, event_order asc`,
          [sessionId, channel],
        );

    return result.rows.map((row) => ({
      event_id: String(row.id),
      event_type: row.event_type,
      created_at: row.created_at,
      visible: Boolean(row.visible),
      payload: (row.payload_jsonb ?? {}) as AskmoreV2VisibleEvent["payload"],
    })) as AskmoreV2TurnEvent[];
  }

  async getTurnEventById(
    sessionId: string,
    eventId: string,
    channel: AskmoreV2EventChannel = "visible",
  ): Promise<AskmoreV2TurnEvent | null> {
    ensureDb();
    const result = await dbQuery(
      `select *
       from askmore_v2_turn_events
       where session_id = $1 and id = $2 and event_channel = $3
       limit 1`,
      [sessionId, eventId, channel],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      event_id: String(row.id),
      event_type: row.event_type,
      created_at: row.created_at,
      visible: Boolean(row.visible),
      payload: (row.payload_jsonb ?? {}) as AskmoreV2VisibleEvent["payload"],
    } as AskmoreV2TurnEvent;
  }

  async getTurnCommit(sessionId: string, clientTurnId: string): Promise<AskmoreV2TurnCommitRecord | null> {
    ensureDb();
    const result = await dbQuery(
      `select *
       from askmore_v2_turn_commits
       where session_id = $1 and client_turn_id = $2`,
      [sessionId, clientTurnId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      session_id: String(row.session_id),
      client_turn_id: String(row.client_turn_id),
      turn_id: String(row.turn_id),
      response_jsonb: row.response_jsonb,
      created_at: String(row.created_at),
    } as AskmoreV2TurnCommitRecord;
  }

  async createTurnCommit(record: AskmoreV2TurnCommitRecord): Promise<void> {
    ensureDb();
    await dbQuery(
      `insert into askmore_v2_turn_commits
       (session_id, client_turn_id, turn_id, response_jsonb, created_at)
       values ($1,$2,$3,$4::jsonb,$5)`,
      [
        record.session_id,
        record.client_turn_id,
        record.turn_id,
        toJsonbParam(record.response_jsonb),
        record.created_at,
      ],
    );
  }

  async createInsightRun(record: AskmoreV2InsightRunRecord): Promise<void> {
    ensureDb();
    await dbQuery(
      `insert into askmore_v2_insight_runs
       (id, session_id, trigger_source, domain, subdomain, language, pack_trace_jsonb, input_snapshot_jsonb, result_jsonb, quality_flags_jsonb, error_text, created_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)`,
      [
        record.id,
        record.session_id,
        record.trigger_source,
        record.domain,
        record.subdomain,
        record.language,
        toJsonbParam(record.pack_trace_jsonb),
        toJsonbParam(record.input_snapshot_jsonb),
        toJsonbParam(record.result_jsonb),
        toJsonbParam(record.quality_flags_jsonb),
        record.error_text,
        record.created_at,
      ],
    );
  }

  async listInsightRuns(
    sessionId: string,
    limit = 20,
    workspaceId?: string,
  ): Promise<AskmoreV2InsightRunRecord[]> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    const result = await dbQuery(
      `select r.*
       from askmore_v2_insight_runs r
       join askmore_v2_sessions s on s.id = r.session_id
       where r.session_id = $1 and s.workspace_id = $2
       order by r.created_at desc
       limit $3`,
      [sessionId, scopeWorkspaceId, limit],
    );
    return result.rows as AskmoreV2InsightRunRecord[];
  }

  async getLatestInsightRun(sessionId: string, workspaceId?: string): Promise<AskmoreV2InsightRunRecord | null> {
    ensureDb();
    const scopeWorkspaceId = resolveWorkspaceId(workspaceId);
    const result = await dbQuery(
      `select r.*
       from askmore_v2_insight_runs r
       join askmore_v2_sessions s on s.id = r.session_id
       where r.session_id = $1 and s.workspace_id = $2
       order by r.created_at desc
       limit 1`,
      [sessionId, scopeWorkspaceId],
    );
    return (result.rows[0] as AskmoreV2InsightRunRecord | undefined) ?? null;
  }
}
