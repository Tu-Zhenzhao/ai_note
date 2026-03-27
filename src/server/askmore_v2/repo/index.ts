import { getPool } from "@/server/repo/db";
import { AskmoreV2Repository } from "@/server/askmore_v2/repo/contracts";
import { MemoryAskmoreV2Repository } from "@/server/askmore_v2/repo/memory-repo";
import { PostgresAskmoreV2Repository } from "@/server/askmore_v2/repo/postgres-repo";

let repo: AskmoreV2Repository | null = null;

export function getAskmoreV2Repository(): AskmoreV2Repository {
  if (!repo) {
    if (!process.env.DATABASE_URL) {
      if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
        repo = new MemoryAskmoreV2Repository();
      } else {
        throw new Error("Askmore v2 requires DATABASE_URL. Run migrations including 006_askmore_v2_schema.sql through 010_askmore_v2_ai_thinking_v2_cutover.sql.");
      }
    } else {
      const pool = getPool();
      if (!pool) {
        throw new Error("Askmore v2 requires DATABASE_URL. Run migrations including 006_askmore_v2_schema.sql through 010_askmore_v2_ai_thinking_v2_cutover.sql.");
      }
      repo = new PostgresAskmoreV2Repository();
    }
  }
  return repo;
}

export function resetAskmoreV2RepositoryForTests(): void {
  repo = null;
}
