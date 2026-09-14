create extension if not exists pgcrypto;

create table if not exists public.address_book (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  company text not null,
  country text not null default 'United States',
  address1 text not null,
  address2 text not null default '',
  zip text not null,
  state text not null,
  city text not null,
  phone text not null default '',
  extension text not null default '',
  contact text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists address_book_company_idx
  on public.address_book (company);

create index if not exists address_book_zip_idx
  on public.address_book (zip);

alter table public.address_book enable row level security;
revoke all on table public.address_book from anon, authenticated;

comment on table public.address_book is
  'Saved LTL sender and receiver addresses. Accessed only by the application server secret key.';
