import { randomUUID } from "crypto";
import { getPool } from "@/server/repo/db";
import { ContextWindowInfo, TokenUsage } from "@/server/model/adapters";

export async function persistTurnUsageEvent(params: {
  conversationId: string;
  contextWindow: ContextWindowInfo;
  turnUsage: TokenUsage;
}) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `insert into turn_usage_events
     (id, conversation_id, model_used, provider, max_context_tokens, used_tokens, utilization_percent,
      prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(),
      params.conversationId,
      params.contextWindow.modelUsed,
      params.contextWindow.provider,
      params.contextWindow.maxContextTokens,
      params.contextWindow.usedTokens,
      params.contextWindow.utilizationPercent,
      params.turnUsage.promptTokens,
      params.turnUsage.completionTokens,
      params.turnUsage.totalTokens,
      params.contextWindow.estimatedCostUsd,
      new Date().toISOString(),
    ],
  );
}

export async function getConversationCumulativeTokens(conversationId: string): Promise<TokenUsage> {
  const pool = getPool();
  if (!pool) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
  const result = await pool.query<{
    prompt_tokens: string | number | null;
    completion_tokens: string | number | null;
    total_tokens: string | number | null;
  }>(
    `select
       coalesce(sum(prompt_tokens), 0) as prompt_tokens,
       coalesce(sum(completion_tokens), 0) as completion_tokens,
       coalesce(sum(total_tokens), 0) as total_tokens
     from turn_usage_events
     where conversation_id = $1`,
    [conversationId],
  );
  const row = result.rows[0] ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  return {
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
  };
}
