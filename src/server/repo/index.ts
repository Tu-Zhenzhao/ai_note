import { MemoryInterviewRepository } from "@/server/repo/memory-repo";
import { PostgresInterviewRepository } from "@/server/repo/postgres-repo";

let repo: MemoryInterviewRepository | PostgresInterviewRepository | null = null;

export function getInterviewRepository() {
  if (!repo) {
    repo = process.env.DATABASE_URL ? new PostgresInterviewRepository() : new MemoryInterviewRepository();
  }
  return repo;
}
