create table if not exists askmore_v2_session_feedback (
  id text primary key,
  session_id text not null unique references askmore_v2_sessions(id) on delete cascade,
  workspace_id text not null references auth_workspaces(id) on delete cascade,
  user_id text not null references auth_users(id) on delete cascade,
  helpful boolean null,
  satisfaction_score int null check (satisfaction_score between 1 and 5),
  goal_text text null,
  issue_text text null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_askmore_v2_feedback_user_updated
  on askmore_v2_session_feedback(user_id, updated_at desc);

create index if not exists idx_askmore_v2_feedback_workspace_updated
  on askmore_v2_session_feedback(workspace_id, updated_at desc);
