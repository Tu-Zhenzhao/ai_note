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
