import { getPool } from "@/server/repo/db";
import { SuperV1RuntimeError, normalizeSuperV1Error } from "@/server/superv1/runtime-errors";

const REQUIRED_TABLES = [
  "public.conversations",
  "public.checklist_templates",
  "public.checklist_answers",
  "public.turns",
  "public.extraction_events",
  "public.planner_events",
];

export async function ensureSuperV1PostgresReady(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new SuperV1RuntimeError(
      "SUPERV1_DATABASE_URL_MISSING",
      "SuperV1 requires DATABASE_URL. Configure Postgres and rerun migrations 001 + 002.",
      500,
    );
  }

  const pool = getPool();
  if (!pool) {
    throw new SuperV1RuntimeError(
      "SUPERV1_DATABASE_URL_MISSING",
      "SuperV1 requires DATABASE_URL. Configure Postgres and rerun migrations 001 + 002.",
      500,
    );
  }

  try {
    await pool.query("select 1");
    const missing = await pool.query<{ table_name: string }>(
      `select required.table_name
       from unnest($1::text[]) as required(table_name)
       where to_regclass(required.table_name) is null`,
      [REQUIRED_TABLES],
    );

    if (missing.rows.length > 0) {
      const missingTables = missing.rows.map((row) => row.table_name);
      throw new SuperV1RuntimeError(
        "SUPERV1_SCHEMA_MISSING",
        "SuperV1 schema is missing. Apply migrations 001 + 002 before starting runtime.",
        500,
        { missing_tables: missingTables },
      );
    }
  } catch (error) {
    throw normalizeSuperV1Error(error);
  }
}
