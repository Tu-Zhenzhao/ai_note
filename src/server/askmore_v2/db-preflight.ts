import { getPool } from "@/server/repo/db";

const REQUIRED_TABLES = [
  "public.askmore_v2_flow_versions",
  "public.askmore_v2_sessions",
  "public.askmore_v2_messages",
  "public.askmore_v2_turn_events",
  "public.askmore_v2_turn_commits",
];

export async function ensureAskmoreV2PostgresReady(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Askmore v2 requires DATABASE_URL. Configure Postgres and run migrations through 008.");
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("Askmore v2 requires DATABASE_URL. Configure Postgres and run migrations through 008.");
  }

  await pool.query("select 1");
  const missing = await pool.query<{ table_name: string }>(
    `select required.table_name
     from unnest($1::text[]) as required(table_name)
     where to_regclass(required.table_name) is null`,
    [REQUIRED_TABLES],
  );

  if (missing.rows.length > 0) {
    const names = missing.rows.map((row) => row.table_name).join(", ");
    throw new Error(`Askmore v2 schema is missing tables: ${names}. Apply migrations 006_askmore_v2_schema.sql through 008_askmore_v2_presentation_layer.sql.`);
  }

  const missingColumn = await pool.query<{ exists: boolean }>(
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
