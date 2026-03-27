create table if not exists interview_sessions (
  id text primary key,
  user_id text not null,
  status text not null,
  current_module text not null,
  current_question_id text not null,
  completion_level text not null,
  completion_score int not null,
  model_primary text not null,
  model_fallback text not null,
  state_schema_version text not null default '3',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists interview_state (
  session_id text primary key references interview_sessions(id) on delete cascade,
  state_jsonb jsonb not null,
  preview_jsonb jsonb not null,
  assessment_jsonb jsonb not null,
  last_checkpoint_at timestamptz null
);

create table if not exists interview_messages (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null
);

create table if not exists generated_briefs (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  format text not null,
  brief_jsonb jsonb not null,
  approved boolean not null,
  created_at timestamptz not null
);

create table if not exists generated_contents (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  brief_id text not null references generated_briefs(id) on delete cascade,
  format text not null,
  content_jsonb jsonb not null,
  created_at timestamptz not null
);

create table if not exists handoff_summaries (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  summary_jsonb jsonb not null,
  created_at timestamptz not null
);

create extension if not exists vector;

create table if not exists chat_book_entries (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  entry_type text not null,
  text text not null,
  module text null,
  confidence real not null default 0.5,
  status text not null default 'active',
  source_turn_ids text[] not null default '{}',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table if not exists chat_book_embeddings (
  entry_id text primary key references chat_book_entries(id) on delete cascade,
  embedding vector(1536) null
);

create table if not exists planner_decisions (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  turn_id text not null,
  chosen_action text not null,
  question_style text not null,
  rationale text not null,
  target_fields text[] not null default '{}',
  created_at timestamptz not null
);

create table if not exists payload_patch_log (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  turn_id text not null,
  patch_json jsonb not null,
  applied_by_tool text not null,
  created_at timestamptz not null
);

create table if not exists tool_action_log (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  turn_id text not null,
  tool_name text not null,
  input_json jsonb not null,
  output_json jsonb not null,
  success boolean not null,
  created_at timestamptz not null
);

create table if not exists checkpoint_snapshots (
  id text primary key,
  session_id text not null references interview_sessions(id) on delete cascade,
  snapshot_json jsonb not null,
  user_confirmed boolean not null default false,
  created_at timestamptz not null
);

create index if not exists idx_chat_book_entries_session_created
  on chat_book_entries(session_id, created_at desc);
create index if not exists idx_planner_decisions_session_created
  on planner_decisions(session_id, created_at desc);
create index if not exists idx_tool_action_log_session_created
  on tool_action_log(session_id, created_at desc);
create index if not exists idx_payload_patch_log_session_created
  on payload_patch_log(session_id, created_at desc);
create index if not exists idx_checkpoint_snapshots_session_created
  on checkpoint_snapshots(session_id, created_at desc);

-- SuperV1 normalized intake runtime tables
create table if not exists conversations (
  id text primary key,
  template_id text not null,
  status text not null,
  active_section_id text,
  current_question_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists checklist_templates (
  id text primary key,
  template_id text not null,
  section_id text not null,
  question_id text not null,
  question_text text not null,
  question_description text,
  field_type text not null,
  is_required boolean not null,
  display_order int not null
);

create unique index if not exists idx_checklist_templates_template_question
  on checklist_templates(template_id, question_id);
create index if not exists idx_checklist_templates_template_order
  on checklist_templates(template_id, display_order);

create table if not exists turns (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  role text not null,
  message_text text not null,
  created_at timestamptz not null
);

create index if not exists idx_turns_conversation_created
  on turns(conversation_id, created_at desc);

create table if not exists checklist_answers (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  question_id text not null,
  value_json jsonb,
  status text not null,
  confidence real,
  evidence_text text,
  source_turn_id text null references turns(id) on delete set null,
  updated_at timestamptz not null
);

create unique index if not exists idx_checklist_answers_conversation_question
  on checklist_answers(conversation_id, question_id);
create index if not exists idx_checklist_answers_conversation_updated
  on checklist_answers(conversation_id, updated_at desc);

create table if not exists extraction_events (
  id text primary key,
  turn_id text not null references turns(id) on delete cascade,
  raw_extraction_json jsonb not null,
  accepted_updates_json jsonb not null,
  rejected_updates_json jsonb not null,
  created_at timestamptz not null
);

create index if not exists idx_extraction_events_turn_created
  on extraction_events(turn_id, created_at desc);

create table if not exists planner_events (
  id text primary key,
  turn_id text not null references turns(id) on delete cascade,
  planner_result_json jsonb not null,
  created_at timestamptz not null
);

create index if not exists idx_planner_events_turn_created
  on planner_events(turn_id, created_at desc);

-- AskMore v0.2 runtime tables
create table if not exists askmore_v2_flow_versions (
  id text primary key,
  version int not null unique,
  status text not null check (status in ('draft', 'published')),
  flow_jsonb jsonb not null,
  published_at timestamptz null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_askmore_v2_flow_versions_status_version
  on askmore_v2_flow_versions(status, version desc);

create table if not exists askmore_v2_sessions (
  id text primary key,
  flow_version_id text not null references askmore_v2_flow_versions(id),
  status text not null check (status in ('in_progress', 'completed')),
  turn_count int not null default 0,
  state_version int not null default 1,
  state_jsonb jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_askmore_v2_sessions_flow_version
  on askmore_v2_sessions(flow_version_id);
create index if not exists idx_askmore_v2_sessions_status_updated
  on askmore_v2_sessions(status, updated_at desc);

create table if not exists askmore_v2_messages (
  id text primary key,
  session_id text not null references askmore_v2_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  message_text text not null,
  created_at timestamptz not null
);

create index if not exists idx_askmore_v2_messages_session_created
  on askmore_v2_messages(session_id, created_at asc);

create table if not exists askmore_v2_turn_events (
  id text primary key,
  session_id text not null references askmore_v2_sessions(id) on delete cascade,
  turn_id text not null,
  event_channel text not null default 'visible',
  event_order int not null,
  event_type text not null,
  payload_jsonb jsonb not null,
  visible boolean not null default true,
  created_at timestamptz not null
);

create index if not exists idx_askmore_v2_turn_events_session_turn_order
  on askmore_v2_turn_events(session_id, turn_id, event_channel, event_order asc);
create index if not exists idx_askmore_v2_turn_events_session_created
  on askmore_v2_turn_events(session_id, event_channel, created_at asc);

create table if not exists askmore_v2_turn_commits (
  session_id text not null references askmore_v2_sessions(id) on delete cascade,
  client_turn_id text not null,
  turn_id text not null,
  response_jsonb jsonb not null,
  created_at timestamptz not null,
  primary key (session_id, client_turn_id)
);

create index if not exists idx_askmore_v2_turn_commits_session_created
  on askmore_v2_turn_commits(session_id, created_at desc);

create table if not exists askmore_v2_insight_runs (
  id text primary key,
  session_id text not null references askmore_v2_sessions(id) on delete cascade,
  trigger_source text not null check (trigger_source in ('manual', 'auto_on_completed')),
  domain text not null,
  subdomain text null,
  language text not null check (language in ('en', 'zh')),
  pack_trace_jsonb jsonb not null,
  input_snapshot_jsonb jsonb not null,
  result_jsonb jsonb null,
  quality_flags_jsonb jsonb null,
  error_text text null,
  created_at timestamptz not null
);

create index if not exists idx_askmore_v2_insight_runs_session_created
  on askmore_v2_insight_runs(session_id, created_at desc);
