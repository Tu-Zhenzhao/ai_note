import {
  AskmoreV2FlowVersion,
  AskmoreV2Message,
  AskmoreV2Session,
} from "@/server/askmore_v2/types";
import { AskmoreV2Repository } from "@/server/askmore_v2/repo/contracts";
import { getPool } from "@/server/repo/db";

function toJsonbParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class PostgresAskmoreV2Repository implements AskmoreV2Repository {
  private pool = getPool();

  private ensurePool() {
    if (!this.pool) {
      throw new Error("DATABASE_URL not configured");
    }
    return this.pool;
  }

  async createFlowVersion(flow: AskmoreV2FlowVersion): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
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
    const pool = this.ensurePool();
    const result = await pool.query(
      `select *
       from askmore_v2_flow_versions
       order by version desc
       limit $1`,
      [limit],
    );
    return result.rows as AskmoreV2FlowVersion[];
  }

  async getFlowVersion(flowVersionId: string): Promise<AskmoreV2FlowVersion | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `select *
       from askmore_v2_flow_versions
       where id = $1`,
      [flowVersionId],
    );
    return (result.rows[0] as AskmoreV2FlowVersion | undefined) ?? null;
  }

  async getActiveFlowVersion(): Promise<AskmoreV2FlowVersion | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `select *
       from askmore_v2_flow_versions
       where status = 'published'
       order by version desc
       limit 1`,
    );
    return (result.rows[0] as AskmoreV2FlowVersion | undefined) ?? null;
  }

  async clearPublishedFlowVersions(): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `update askmore_v2_flow_versions
       set status = 'draft',
           published_at = null,
           updated_at = now()
       where status = 'published'`,
    );
  }

  async createSession(session: AskmoreV2Session): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `insert into askmore_v2_sessions
       (id, flow_version_id, status, turn_count, state_jsonb, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        session.id,
        session.flow_version_id,
        session.status,
        session.turn_count,
        toJsonbParam(session.state_jsonb),
        session.created_at,
        session.updated_at,
      ],
    );
  }

  async getSession(sessionId: string): Promise<AskmoreV2Session | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `select *
       from askmore_v2_sessions
       where id = $1`,
      [sessionId],
    );
    return (result.rows[0] as AskmoreV2Session | undefined) ?? null;
  }

  async listSessions(limit = 100): Promise<AskmoreV2Session[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `select *
       from askmore_v2_sessions
       order by updated_at desc
       limit $1`,
      [limit],
    );
    return result.rows as AskmoreV2Session[];
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `delete from askmore_v2_sessions
       where id = $1`,
      [sessionId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateSession(session: AskmoreV2Session): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `update askmore_v2_sessions
       set flow_version_id = $2,
           status = $3,
           turn_count = $4,
           state_jsonb = $5::jsonb,
           updated_at = $6
       where id = $1`,
      [
        session.id,
        session.flow_version_id,
        session.status,
        session.turn_count,
        toJsonbParam(session.state_jsonb),
        session.updated_at,
      ],
    );
  }

  async addMessage(message: AskmoreV2Message): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
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
    const pool = this.ensurePool();
    if (!limit) {
      const result = await pool.query(
        `select *
         from askmore_v2_messages
         where session_id = $1
         order by created_at asc`,
        [sessionId],
      );
      return result.rows as AskmoreV2Message[];
    }

    const result = await pool.query(
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
}
