begin;

create table if not exists public.quote_input_history (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  customer_id uuid not null,
  customer_name text not null,
  user_id uuid not null,
  user_email text not null,
  source text not null check (source in ('desktop', 'mobile')),
  input_text text not null check (char_length(input_text) between 1 and 100000)
);

alter table public.quote_input_history enable row level security;
revoke all on public.quote_input_history from anon, authenticated;
grant select, insert on public.quote_input_history to service_role;
grant usage, select on sequence public.quote_input_history_id_seq to service_role;

commit;
