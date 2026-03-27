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
