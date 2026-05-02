import { getPool, resetPool } from "@/server/repo/db";

const REQUIRED_TABLES = [
  "public.askmore_v2_flow_versions",
  "public.askmore_v2_sessions",
  "public.askmore_v2_messages",
  "public.askmore_v2_session_feedback",
  "public.askmore_v2_turn_events",
  "public.askmore_v2_turn_commits",
  "public.askmore_v2_insight_runs",
];

export async function ensureAskmoreV2PostgresReady(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Askmore v2 requires DATABASE_URL. Configure Postgres and run migrations through 010.");
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("Askmore v2 requires DATABASE_URL. Configure Postgres and run migrations through 010.");
  }
  let activePool = pool;

  try {
    await activePool.query("select 1");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTransientTimeout =
      /connection timeout|timeout exceeded|timeout expired|could not connect|ecconnreset|terminated/i.test(message);
    if (!isTransientTimeout) {
      throw error;
    }

    // Retry once on transient DB connectivity failures by recreating the pool.
    await resetPool();
    const retryPool = getPool();
    if (!retryPool) {
      throw new Error("Askmore v2 requires DATABASE_URL. Configure Postgres and run migrations through 010.");
    }
    await retryPool.query("select 1");
    activePool = retryPool;
  }
  const missing = await activePool.query<{ table_name: string }>(
    `select required.table_name
     from unnest($1::text[]) as required(table_name)
     where to_regclass(required.table_name) is null`,
    [REQUIRED_TABLES],
  );

  if (missing.rows.length > 0) {
    const names = missing.rows.map((row) => row.table_name).join(", ");
    throw new Error(`Askmore v2 schema is missing tables: ${names}. Apply migrations 006_askmore_v2_schema.sql through 010_askmore_v2_ai_thinking_v2_cutover.sql.`);
  }

  const missingColumn = await activePool.query<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'askmore_v2_turn_events'
         and column_name = 'event_channel'
     )`,
  );
  if (!missingColumn.rows[0]?.exists) {
    throw new Error("Askmore v2 schema is missing askmore_v2_turn_events.event_channel. Apply migration 008_askmore_v2_presentation_layer.sql.");
  }
}
