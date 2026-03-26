import {
  AskmoreV2EventChannel,
  AskmoreV2FlowVersion,
  AskmoreV2Message,
  AskmoreV2Session,
  AskmoreV2TurnCommitRecord,
  AskmoreV2TurnEvent,
  AskmoreV2VisibleEvent,
} from "@/server/askmore_v2/types";
import { AskmoreV2Repository } from "@/server/askmore_v2/repo/contracts";
import { dbQuery, getActiveDbExecutor } from "@/server/repo/db";

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

export class PostgresAskmoreV2Repository implements AskmoreV2Repository {
  async createFlowVersion(flow: AskmoreV2FlowVersion): Promise<void> {
    ensureDb();
    await dbQuery(
      `insert into askmore_v2_flow_versions
       (id, version, status, flow_jsonb, published_at, created_at, updated_at)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [
        flow.id,
        flow.version,
        flow.status,
        toJsonbParam(flow.flow_jsonb),
        flow.published_at,
        flow.created_at,
        flow.updated_at,
      ],
    );
  }

  async listFlowVersions(limit = 50): Promise<AskmoreV2FlowVersion[]> {
    ensureDb();
    const result = await dbQuery(
      `select *
       from askmore_v2_flow_versions
       order by version desc
       limit $1`,
      [limit],
    );
    return result.rows as AskmoreV2FlowVersion[];
  }

  async getFlowVersion(flowVersionId: string): Promise<AskmoreV2FlowVersion | null> {
    ensureDb();
    const result = await dbQuery(
      `select *
       from askmore_v2_flow_versions
       where id = $1`,
      [flowVersionId],
    );
    return (result.rows[0] as AskmoreV2FlowVersion | undefined) ?? null;
  }

  async getActiveFlowVersion(): Promise<AskmoreV2FlowVersion | null> {
    ensureDb();
    const result = await dbQuery(
      `select *
       from askmore_v2_flow_versions
       where status = 'published'
       order by version desc
       limit 1`,
    );
    return (result.rows[0] as AskmoreV2FlowVersion | undefined) ?? null;
  }

  async clearPublishedFlowVersions(): Promise<void> {
    ensureDb();
    await dbQuery(
      `update askmore_v2_flow_versions
       set status = 'draft',
           published_at = null,
           updated_at = now()
       where status = 'published'`,
    );
  }

  async createSession(session: AskmoreV2Session): Promise<void> {
    ensureDb();
    await dbQuery(
      `insert into askmore_v2_sessions
       (id, flow_version_id, status, turn_count, state_version, state_jsonb, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        session.id,
        session.flow_version_id,
        session.status,
        session.turn_count,
        session.state_version > 0 ? session.state_version : 1,
        toJsonbParam(session.state_jsonb),
        session.created_at,
        session.updated_at,
      ],
    );
  }

  async getSession(sessionId: string): Promise<AskmoreV2Session | null> {
    ensureDb();
    const result = await dbQuery(
      `select *
       from askmore_v2_sessions
       where id = $1`,
      [sessionId],
    );
    const row = result.rows[0] as AskmoreV2Session | undefined;
    if (!row) return null;
    if (typeof row.state_version !== "number") {
      row.state_version = 1;
    }
    return row;
  }

  async listSessions(limit = 100): Promise<AskmoreV2Session[]> {
    ensureDb();
    const result = await dbQuery(
      `select *
       from askmore_v2_sessions
       order by updated_at desc
       limit $1`,
      [limit],
    );
    return (result.rows as AskmoreV2Session[]).map((row) => ({
      ...row,
      state_version: typeof row.state_version === "number" ? row.state_version : 1,
    }));
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    ensureDb();
    const result = await dbQuery(
      `delete from askmore_v2_sessions
       where id = $1`,
      [sessionId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateSession(session: AskmoreV2Session): Promise<void> {
    ensureDb();
    const currentVersion = typeof session.state_version === "number" ? session.state_version : 1;
    const result = await dbQuery(
      `update askmore_v2_sessions
       set flow_version_id = $2,
           status = $3,
           turn_count = $4,
           state_version = state_version + 1,
           state_jsonb = $5::jsonb,
           updated_at = $6
       where id = $1 and state_version = $7`,
      [
        session.id,
        session.flow_version_id,
        session.status,
        session.turn_count,
        toJsonbParam(session.state_jsonb),
        session.updated_at,
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
}
