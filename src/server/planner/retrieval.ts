import { ChatBookEntry, ConflictRecord } from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";

export interface RecalledMemory {
  entry: ChatBookEntry;
  score: number;
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function keywordScore(queryTokens: string[], entryTokens: string[]) {
  if (!queryTokens.length || !entryTokens.length) return 0;
  const entrySet = new Set(entryTokens);
  let overlap = 0;
  for (const token of queryTokens) {
    if (entrySet.has(token)) overlap += 1;
  }
  return overlap / Math.max(queryTokens.length, 1);
}

function recencyScore(createdAt: string, nowMs: number) {
  const ageHours = Math.max((nowMs - new Date(createdAt).getTime()) / (1000 * 60 * 60), 0);
  return Math.exp(-ageHours / 72);
}

export async function recallChatBook(params: {
  repo: InterviewRepository;
  sessionId: string;
  query: string;
  module?: string;
  limit?: number;
}): Promise<RecalledMemory[]> {
  const items = await params.repo.listChatBookEntries(params.sessionId, 40);
  const queryTokens = tokenize(params.query);
  const nowMs = Date.now();

  const scored = items
    .filter((entry) => !params.module || entry.module === params.module)
    .map((entry) => {
      const score =
        0.65 * keywordScore(queryTokens, tokenize(entry.text)) +
        0.35 * recencyScore(entry.created_at, nowMs);
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, params.limit ?? 8);
}

export function recallUnresolvedConflicts(conflicts: ConflictRecord[]) {
  return conflicts.filter((conflict) => conflict.status === "pending");
}
