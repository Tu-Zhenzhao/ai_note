create table if not exists auth_users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  display_name text null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_login_at timestamptz null
);

create table if not exists auth_workspaces (
  id text primary key,
  owner_user_id text null references auth_users(id) on delete set null,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists auth_workspace_members (
  workspace_id text not null references auth_workspaces(id) on delete cascade,
  user_id text not null references auth_users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null,
  primary key (workspace_id, user_id)
);

create table if not exists auth_sessions (
  id text primary key,
  session_token_hash text not null unique,
  user_id text not null references auth_users(id) on delete cascade,
  workspace_id text not null references auth_workspaces(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  ip text null,
  user_agent text null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_auth_sessions_user_updated
  on auth_sessions(user_id, updated_at desc);
create index if not exists idx_auth_sessions_workspace_updated
  on auth_sessions(workspace_id, updated_at desc);
create index if not exists idx_auth_sessions_token_active
  on auth_sessions(session_token_hash, expires_at desc);

insert into auth_workspaces (id, owner_user_id, name, slug, created_at, updated_at)
values ('ws_default_beta', null, 'Default Workspace', 'default-workspace', now(), now())
on conflict (id) do nothing;

alter table askmore_v2_flow_versions
  add column if not exists workspace_id text;

alter table askmore_v2_sessions
  add column if not exists workspace_id text;

alter table askmore_v2_sessions
  add column if not exists created_by_user_id text null references auth_users(id) on delete set null;

update askmore_v2_flow_versions
set workspace_id = 'ws_default_beta'
where workspace_id is null;

update askmore_v2_sessions
set workspace_id = 'ws_default_beta'
where workspace_id is null;

alter table askmore_v2_flow_versions
  alter column workspace_id set not null;

alter table askmore_v2_sessions
  alter column workspace_id set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'askmore_v2_flow_versions_version_key'
  ) then
    alter table askmore_v2_flow_versions drop constraint askmore_v2_flow_versions_version_key;
  end if;
end $$;

create unique index if not exists uq_askmore_v2_flow_versions_workspace_version
  on askmore_v2_flow_versions(workspace_id, version);

create index if not exists idx_askmore_v2_flow_versions_workspace_status_version
  on askmore_v2_flow_versions(workspace_id, status, version desc);

create index if not exists idx_askmore_v2_sessions_workspace_status_updated
  on askmore_v2_sessions(workspace_id, status, updated_at desc);

create index if not exists idx_askmore_v2_sessions_workspace_flow
  on askmore_v2_sessions(workspace_id, flow_version_id);
