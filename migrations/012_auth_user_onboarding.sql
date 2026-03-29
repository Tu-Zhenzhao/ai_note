alter table auth_users
  add column if not exists onboarding_completed_at timestamptz null;
