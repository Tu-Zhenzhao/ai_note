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
