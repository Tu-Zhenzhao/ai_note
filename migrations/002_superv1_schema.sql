-- Migration 002: SuperV1 normalized intake runtime tables

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL,
  active_section_id TEXT,
  current_question_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_templates (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_description TEXT,
  field_type TEXT NOT NULL,
  is_required BOOLEAN NOT NULL,
  display_order INT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_templates_template_question
  ON checklist_templates(template_id, question_id);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_template_order
  ON checklist_templates(template_id, display_order);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  message_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_conversation_created
  ON turns(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS checklist_answers (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  value_json JSONB,
  status TEXT NOT NULL,
  confidence REAL,
  evidence_text TEXT,
  source_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_answers_conversation_question
  ON checklist_answers(conversation_id, question_id);
CREATE INDEX IF NOT EXISTS idx_checklist_answers_conversation_updated
  ON checklist_answers(conversation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS extraction_events (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  raw_extraction_json JSONB NOT NULL,
  accepted_updates_json JSONB NOT NULL,
  rejected_updates_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_extraction_events_turn_created
  ON extraction_events(turn_id, created_at DESC);

CREATE TABLE IF NOT EXISTS planner_events (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  planner_result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planner_events_turn_created
  ON planner_events(turn_id, created_at DESC);
