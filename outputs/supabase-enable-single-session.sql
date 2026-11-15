alter table public.app_users
  add column if not exists active_session_id uuid;
