-- Migration 001: Initial schema for interview application
-- Run once against the target database.

CREATE TABLE IF NOT EXISTS interview_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  status TEXT,
  current_module TEXT,
  current_question_id TEXT,
  completion_level TEXT,
  completion_score REAL DEFAULT 0,
  model_primary TEXT,
  model_fallback TEXT,
  state_schema_version TEXT DEFAULT '3',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS interview_state (
  session_id TEXT PRIMARY KEY,
  state_jsonb JSONB,
  preview_jsonb JSONB,
  assessment_jsonb JSONB,
  last_checkpoint_at TEXT
);

CREATE TABLE IF NOT EXISTS interview_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON interview_messages (session_id, created_at);

CREATE TABLE IF NOT EXISTS generated_briefs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  format TEXT,
  brief_jsonb JSONB,
  approved BOOLEAN DEFAULT FALSE,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS generated_contents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  brief_id TEXT,
  format TEXT,
  content_jsonb JSONB,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS handoff_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary_jsonb JSONB,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_book_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  entry_type TEXT,
  text TEXT,
  module TEXT,
  confidence REAL,
  status TEXT,
  source_turn_ids TEXT[],
  metadata_json JSONB,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chatbook_session ON chat_book_entries (session_id, created_at);

CREATE TABLE IF NOT EXISTS planner_decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  chosen_action TEXT,
  question_style TEXT,
  rationale TEXT,
  target_fields TEXT[],
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_planner_session ON planner_decisions (session_id, created_at);

CREATE TABLE IF NOT EXISTS payload_patch_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  patch_json JSONB,
  applied_by_tool TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_patchlog_session ON payload_patch_log (session_id, created_at);

CREATE TABLE IF NOT EXISTS tool_action_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  tool_name TEXT,
  input_json JSONB,
  output_json JSONB,
  success BOOLEAN,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_toollog_session ON tool_action_log (session_id, created_at);

CREATE TABLE IF NOT EXISTS checkpoint_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  snapshot_json JSONB,
  user_confirmed BOOLEAN DEFAULT FALSE,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkpoint_session ON checkpoint_snapshots (session_id, created_at);
