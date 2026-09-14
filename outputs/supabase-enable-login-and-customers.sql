-- Adds login, customer ownership, and per-customer pricing without deleting existing data.
create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  active boolean not null default true,
  is_internal boolean not null default false,
  can_self_book boolean not null default true,
  markup_percent numeric(8, 3) not null default 0 check (markup_percent >= 0),
  minimum_markup numeric(12, 2) not null default 0 check (minimum_markup >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.customers (id, name, code, is_internal, active, can_self_book)
values ('00000000-0000-0000-0000-000000000001', 'Shenzhen Qianyushi Supply Chain Service Co.,Ltd.', 'QIANYUSHI', true, true, true)
on conflict (id) do update set is_internal = true;

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  email text not null unique,
  full_name text not null,
  role text not null default 'customer' check (role in ('admin', 'operations', 'sales', 'customer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saved_quotes add column if not exists customer_id uuid references public.customers(id);
update public.saved_quotes set customer_id = '00000000-0000-0000-0000-000000000001' where customer_id is null;
alter table public.saved_quotes alter column customer_id set not null;
create index if not exists saved_quotes_customer_created_idx on public.saved_quotes (customer_id, created_at desc);

alter table public.address_book add column if not exists customer_id uuid references public.customers(id);
update public.address_book set customer_id = '00000000-0000-0000-0000-000000000001' where customer_id is null;
alter table public.address_book alter column customer_id set not null;
alter table public.address_book drop constraint if exists address_book_fingerprint_key;
create unique index if not exists address_book_customer_fingerprint_idx on public.address_book (customer_id, fingerprint);

alter table public.deposit_accounts add column if not exists customer_id uuid references public.customers(id);
update public.deposit_accounts set customer_id = '00000000-0000-0000-0000-000000000001' where customer_id is null;
alter table public.deposit_accounts alter column customer_id set not null;
alter table public.deposit_accounts drop constraint if exists deposit_accounts_pkey;
alter table public.deposit_accounts drop constraint if exists deposit_accounts_id_check;
alter table public.deposit_accounts alter column id drop not null;
alter table public.deposit_accounts alter column id drop default;
alter table public.deposit_accounts add column if not exists account_id uuid default gen_random_uuid();
update public.deposit_accounts set account_id = gen_random_uuid() where account_id is null;
alter table public.deposit_accounts alter column account_id set not null;
alter table public.deposit_accounts add constraint deposit_accounts_pkey primary key (account_id);
create unique index if not exists deposit_accounts_customer_idx on public.deposit_accounts (customer_id);

alter table public.deposit_transactions add column if not exists customer_id uuid references public.customers(id);
update public.deposit_transactions t
set customer_id = coalesce(q.customer_id, '00000000-0000-0000-0000-000000000001')
from public.saved_quotes q
where t.customer_id is null and t.quote_id = q.id;
update public.deposit_transactions set customer_id = '00000000-0000-0000-0000-000000000001' where customer_id is null;
alter table public.deposit_transactions alter column customer_id set not null;
alter table public.deposit_transactions add column if not exists actor_user_id uuid references auth.users(id);
alter table public.deposit_transactions add column if not exists idempotency_key text;
create unique index if not exists deposit_transactions_idempotency_idx on public.deposit_transactions (idempotency_key) where idempotency_key is not null;
create index if not exists deposit_transactions_customer_created_idx on public.deposit_transactions (customer_id, created_at desc);

insert into public.deposit_accounts (id, customer_id, available_balance)
select null, c.id, 0 from public.customers c
where not exists (select 1 from public.deposit_accounts d where d.customer_id = c.id);

alter table public.customers enable row level security;
alter table public.app_users enable row level security;
revoke all on table public.customers from anon, authenticated;
revoke all on table public.app_users from anon, authenticated;

drop function if exists public.reserve_quote_for_bol(uuid);
create or replace function public.reserve_quote_for_bol(p_quote_id uuid, p_customer_id uuid, p_actor_user_id uuid default null)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare q public.saved_quotes%rowtype; new_balance numeric(12, 2);
begin
  select * into q from public.saved_quotes where id = p_quote_id and customer_id = p_customer_id for update;
  if not found then raise exception 'Quote not found'; end if;
  if q.status <> 'draft' then raise exception 'Only a draft quote can generate a BOL'; end if;
  update public.deposit_accounts
  set available_balance = available_balance - q.price, updated_at = now()
  where customer_id = p_customer_id and available_balance >= q.price
  returning available_balance into new_balance;
  if new_balance is null then raise exception 'Insufficient deposit balance'; end if;
  update public.saved_quotes set status = 'booking', updated_at = now() where id = p_quote_id;
  insert into public.deposit_transactions (quote_id, customer_id, actor_user_id, transaction_type, amount, balance_after, idempotency_key)
  values (p_quote_id, p_customer_id, p_actor_user_id, 'BOL_RESERVE', -q.price, new_balance, 'bol-reserve:' || p_quote_id::text)
  on conflict (idempotency_key) where idempotency_key is not null do nothing;
  return new_balance;
end;
$$;

drop function if exists public.release_quote_bol_reservation(uuid);
create or replace function public.release_quote_bol_reservation(p_quote_id uuid, p_customer_id uuid, p_actor_user_id uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare q public.saved_quotes%rowtype; new_balance numeric(12, 2);
begin
  select * into q from public.saved_quotes where id = p_quote_id and customer_id = p_customer_id for update;
  if not found or q.status <> 'booking' then return; end if;
  update public.deposit_accounts set available_balance = available_balance + q.price, updated_at = now()
  where customer_id = p_customer_id returning available_balance into new_balance;
  update public.saved_quotes set status = 'draft', updated_at = now() where id = p_quote_id;
  insert into public.deposit_transactions (quote_id, customer_id, actor_user_id, transaction_type, amount, balance_after, idempotency_key)
  values (p_quote_id, p_customer_id, p_actor_user_id, 'BOOKING_RELEASE', q.price, new_balance, 'bol-release:' || p_quote_id::text)
  on conflict (idempotency_key) where idempotency_key is not null do nothing;
end;
$$;

drop function if exists public.void_quote_and_refund(uuid);
create or replace function public.void_quote_and_refund(p_quote_id uuid, p_customer_id uuid, p_actor_user_id uuid default null)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare q public.saved_quotes%rowtype; new_balance numeric(12, 2);
begin
  select * into q from public.saved_quotes where id = p_quote_id and customer_id = p_customer_id for update;
  if not found then raise exception 'Quote not found'; end if;
  if q.status = 'void' then select available_balance into new_balance from public.deposit_accounts where customer_id = p_customer_id; return new_balance; end if;
  if q.status <> 'booked' then raise exception 'Only a booked shipment can be voided'; end if;
  update public.deposit_accounts set available_balance = available_balance + q.price, updated_at = now()
  where customer_id = p_customer_id returning available_balance into new_balance;
  update public.saved_quotes set status = 'void', voided_at = now(), updated_at = now() where id = p_quote_id;
  insert into public.deposit_transactions (quote_id, customer_id, actor_user_id, transaction_type, amount, balance_after, idempotency_key)
  values (p_quote_id, p_customer_id, p_actor_user_id, 'VOID_REFUND', q.price, new_balance, 'void-refund:' || p_quote_id::text)
  on conflict (idempotency_key) where idempotency_key is not null do nothing;
  return new_balance;
end;
$$;

drop function if exists public.adjust_deposit_balance(numeric, text);
create or replace function public.adjust_deposit_balance(p_customer_id uuid, p_amount numeric, p_reason text, p_actor_user_id uuid default null)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare new_balance numeric(12, 2);
begin
  if p_amount = 0 then raise exception 'Amount cannot be zero'; end if;
  if trim(coalesce(p_reason, '')) = '' then raise exception 'Reason is required'; end if;
  update public.deposit_accounts set available_balance = available_balance + p_amount, updated_at = now()
  where customer_id = p_customer_id and available_balance + p_amount >= 0 returning available_balance into new_balance;
  if new_balance is null then raise exception 'Adjustment would make the deposit balance negative'; end if;
  insert into public.deposit_transactions (quote_id, customer_id, actor_user_id, transaction_type, amount, balance_after, reason)
  values (null, p_customer_id, p_actor_user_id, case when p_amount > 0 then 'DEPOSIT' else 'ADJUSTMENT' end, p_amount, new_balance, trim(p_reason));
  return new_balance;
end;
$$;

revoke all on function public.reserve_quote_for_bol(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_quote_bol_reservation(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.void_quote_and_refund(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.adjust_deposit_balance(uuid, numeric, text, uuid) from public, anon, authenticated;
