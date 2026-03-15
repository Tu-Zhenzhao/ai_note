-- Migration 005: SuperV1 persistent help interaction state and routing audit events

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS interaction_mode TEXT NOT NULL DEFAULT 'interviewing';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS help_context_json JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_interaction_mode_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_interaction_mode_check
      CHECK (interaction_mode IN ('interviewing', 'help_open'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS routing_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  intent TEXT NOT NULL,
  mode_before TEXT NOT NULL,
  mode_after TEXT NOT NULL,
  detected_help_selection_json JSONB,
  decision_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routing_events_conversation_created
  ON routing_events(conversation_id, created_at DESC);
