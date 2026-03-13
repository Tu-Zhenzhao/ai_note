-- Migration 003: Persist per-turn model usage for SuperV1 conversations

CREATE TABLE IF NOT EXISTS turn_usage_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  model_used TEXT NOT NULL,
  provider TEXT NOT NULL,
  max_context_tokens INT NOT NULL,
  used_tokens INT NOT NULL,
  utilization_percent REAL NOT NULL,
  prompt_tokens INT NOT NULL,
  completion_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turn_usage_events_conversation_created
  ON turn_usage_events(conversation_id, created_at DESC);
