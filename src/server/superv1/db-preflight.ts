import { getPool } from "@/server/repo/db";
import { SuperV1RuntimeError, normalizeSuperV1Error } from "@/server/superv1/runtime-errors";

const REQUIRED_TABLES = [
  "public.conversations",
  "public.checklist_templates",
  "public.checklist_answers",
  "public.turns",
  "public.extraction_events",
  "public.planner_events",
  "public.routing_events",
  "public.turn_usage_events",
  "public.ai_suggested_directions",
];

const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "conversations", column: "interaction_mode" },
  { table: "conversations", column: "help_context_json" },
  { table: "routing_events", column: "detected_help_selection_json" },
];

export async function ensureSuperV1PostgresReady(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new SuperV1RuntimeError(
      "SUPERV1_DATABASE_URL_MISSING",
      "SuperV1 requires DATABASE_URL. Configure Postgres and rerun migrations 001 + 002 + 003 + 004 + 005.",
      500,
    );
  }

  const pool = getPool();
  if (!pool) {
    throw new SuperV1RuntimeError(
      "SUPERV1_DATABASE_URL_MISSING",
      "SuperV1 requires DATABASE_URL. Configure Postgres and rerun migrations 001 + 002 + 003 + 004 + 005.",
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
        "SuperV1 schema is missing. Apply migrations 001 + 002 + 003 + 004 + 005 before starting runtime.",
        500,
        { missing_tables: missingTables },
      );
    }

    const columnChecks = await Promise.all(
      REQUIRED_COLUMNS.map(async (entry) => {
        const result = await pool.query<{ exists: boolean }>(
          `select exists (
             select 1
             from information_schema.columns
             where table_schema = 'public'
               and table_name = $1
               and column_name = $2
           )`,
          [entry.table, entry.column],
        );
        return {
          ...entry,
          exists: Boolean(result.rows[0]?.exists),
        };
      }),
    );
    const missingColumns = columnChecks
      .filter((entry) => !entry.exists)
      .map((entry) => `public.${entry.table}.${entry.column}`);
    if (missingColumns.length > 0) {
      throw new SuperV1RuntimeError(
        "SUPERV1_SCHEMA_MISSING",
        "SuperV1 schema is missing. Apply migrations 001 + 002 + 003 + 004 + 005 before starting runtime.",
        500,
        { missing_columns: missingColumns },
      );
    }
  } catch (error) {
    throw normalizeSuperV1Error(error);
  }
}
