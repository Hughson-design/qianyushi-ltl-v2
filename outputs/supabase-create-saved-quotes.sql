create extension if not exists pgcrypto;

create table if not exists public.saved_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,
  status text not null default 'draft' check (status in ('draft', 'booked', 'void')),
  reference text not null,
  origin_zip text not null,
  destination_zip text not null,
  ready_date date,
  carrier text not null,
  service text not null default '',
  transit text not null default '',
  price numeric(12, 2) not null check (price >= 0),
  provider text,
  provider_ref jsonb not null default '{}'::jsonb,
  freight_items jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  sender jsonb not null,
  receiver jsonb not null,
  skip_address_verification boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_quotes_created_at_idx
  on public.saved_quotes (created_at desc);

create index if not exists saved_quotes_reference_idx
  on public.saved_quotes (reference);

alter table public.saved_quotes enable row level security;
revoke all on table public.saved_quotes from anon, authenticated;

comment on table public.saved_quotes is
  'Draft LTL quotes with selected rate and completed booking details. Accessed only by the server secret key.';
