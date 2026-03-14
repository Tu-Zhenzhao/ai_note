-- Migration 004: Persist AI suggested directions for each SuperV1 conversation

CREATE TABLE IF NOT EXISTS ai_suggested_directions (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  source_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  source_answers_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_suggested_directions_updated_at
  ON ai_suggested_directions(updated_at DESC);
