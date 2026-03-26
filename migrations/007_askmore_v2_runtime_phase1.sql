alter table askmore_v2_sessions
  add column if not exists state_version int not null default 1;

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

alter table askmore_v2_turn_events
  add column if not exists event_channel text not null default 'visible';

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
