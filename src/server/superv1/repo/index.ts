import { getPool } from "@/server/repo/db";
import { SuperV1Repository } from "@/server/superv1/repo/contracts";
import { MemorySuperV1Repository } from "@/server/superv1/repo/memory-repo";
import { PostgresSuperV1Repository } from "@/server/superv1/repo/postgres-repo";
import { SuperV1RuntimeError } from "@/server/superv1/runtime-errors";

let repo: SuperV1Repository | null = null;

export function getSuperV1Repository(): SuperV1Repository {
  if (!repo) {
    const hasDatabaseUrl = !!process.env.DATABASE_URL;
    if (!hasDatabaseUrl) {
      if (process.env.NODE_ENV === "test") {
        repo = new MemorySuperV1Repository();
      } else {
        throw new SuperV1RuntimeError(
          "SUPERV1_DATABASE_URL_MISSING",
          "SuperV1 requires DATABASE_URL. Configure Postgres and rerun migrations 001 + 002 + 003 + 004 + 005.",
          500,
        );
      }
    } else {
      const pool = getPool();
      if (!pool) {
        throw new SuperV1RuntimeError(
          "SUPERV1_DATABASE_URL_MISSING",
          "SuperV1 requires DATABASE_URL. Configure Postgres and rerun migrations 001 + 002 + 003 + 004 + 005.",
          500,
        );
      }
      repo = new PostgresSuperV1Repository();
    }
  }
  return repo;
}
