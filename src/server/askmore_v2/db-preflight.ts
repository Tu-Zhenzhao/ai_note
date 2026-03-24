import { getPool } from "@/server/repo/db";

const REQUIRED_TABLES = [
  "public.askmore_v2_flow_versions",
  "public.askmore_v2_sessions",
  "public.askmore_v2_messages",
];

export async function ensureAskmoreV2PostgresReady(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Askmore v2 requires DATABASE_URL. Configure Postgres and run migration 006.");
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("Askmore v2 requires DATABASE_URL. Configure Postgres and run migration 006.");
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
    throw new Error(`Askmore v2 schema is missing tables: ${names}. Apply migration 006_askmore_v2_schema.sql.`);
  }
}
