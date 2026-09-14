alter table public.saved_quotes
  add column if not exists pickup_ready_time text not null default '09:00',
  add column if not exists pickup_close_time text not null default '16:00',
  add column if not exists bol_number text,
  add column if not exists bol_url text,
  add column if not exists provider_shipment_id text,
  add column if not exists provider_pickup_id text,
  add column if not exists provider_document_ref text,
  add column if not exists booked_at timestamptz,
  add column if not exists voided_at timestamptz;

alter table public.saved_quotes drop constraint if exists saved_quotes_status_check;
alter table public.saved_quotes add constraint saved_quotes_status_check
  check (status in ('draft', 'booking', 'booked', 'void'));

create table if not exists public.deposit_accounts (
  id boolean primary key default true check (id),
  available_balance numeric(12, 2) not null default 0 check (available_balance >= 0),
  updated_at timestamptz not null default now()
);

insert into public.deposit_accounts (id, available_balance)
values (true, 0.00)
on conflict (id) do nothing;

create table if not exists public.deposit_transactions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.saved_quotes(id),
  transaction_type text not null check (transaction_type in ('BOL_RESERVE', 'BOOKING_RELEASE', 'VOID_REFUND')),
  amount numeric(12, 2) not null,
  balance_after numeric(12, 2) not null,
  created_at timestamptz not null default now()
);

alter table public.deposit_accounts enable row level security;
alter table public.deposit_transactions enable row level security;
revoke all on table public.deposit_accounts from anon, authenticated;
revoke all on table public.deposit_transactions from anon, authenticated;

create or replace function public.reserve_quote_for_bol(p_quote_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.saved_quotes%rowtype;
  new_balance numeric(12, 2);
begin
  select * into q from public.saved_quotes where id = p_quote_id for update;
  if not found then raise exception 'Quote not found'; end if;
  if q.status <> 'draft' then raise exception 'Only a draft quote can generate a BOL'; end if;

  select available_balance into new_balance from public.deposit_accounts where id = true for update;
  if new_balance < q.price then raise exception 'Insufficient deposit balance'; end if;
  new_balance := new_balance - q.price;

  update public.deposit_accounts set available_balance = new_balance, updated_at = now() where id = true;
  update public.saved_quotes set status = 'booking', updated_at = now() where id = p_quote_id;
  insert into public.deposit_transactions (quote_id, transaction_type, amount, balance_after)
  values (p_quote_id, 'BOL_RESERVE', -q.price, new_balance);
  return new_balance;
end;
$$;

create or replace function public.complete_quote_bol(
  p_quote_id uuid,
  p_bol_number text,
  p_bol_url text,
  p_provider_shipment_id text,
  p_provider_pickup_id text,
  p_provider_document_ref text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.saved_quotes
  set status = 'booked', bol_number = p_bol_number, bol_url = p_bol_url,
      provider_shipment_id = p_provider_shipment_id, provider_pickup_id = p_provider_pickup_id,
      provider_document_ref = p_provider_document_ref, booked_at = now(), updated_at = now()
  where id = p_quote_id and status = 'booking';
  if not found then raise exception 'Quote is not awaiting BOL completion'; end if;
end;
$$;

create or replace function public.release_quote_bol_reservation(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.saved_quotes%rowtype;
  new_balance numeric(12, 2);
begin
  select * into q from public.saved_quotes where id = p_quote_id for update;
  if not found or q.status <> 'booking' then return; end if;
  update public.deposit_accounts
  set available_balance = available_balance + q.price, updated_at = now()
  where id = true returning available_balance into new_balance;
  update public.saved_quotes set status = 'draft', updated_at = now() where id = p_quote_id;
  insert into public.deposit_transactions (quote_id, transaction_type, amount, balance_after)
  values (p_quote_id, 'BOOKING_RELEASE', q.price, new_balance);
end;
$$;

create or replace function public.void_quote_and_refund(p_quote_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.saved_quotes%rowtype;
  new_balance numeric(12, 2);
begin
  select * into q from public.saved_quotes where id = p_quote_id for update;
  if not found then raise exception 'Quote not found'; end if;
  if q.status = 'void' then
    select available_balance into new_balance from public.deposit_accounts where id = true;
    return new_balance;
  end if;
  if q.status <> 'booked' then raise exception 'Only a booked shipment can be voided'; end if;
  update public.deposit_accounts
  set available_balance = available_balance + q.price, updated_at = now()
  where id = true returning available_balance into new_balance;
  update public.saved_quotes set status = 'void', voided_at = now(), updated_at = now() where id = p_quote_id;
  insert into public.deposit_transactions (quote_id, transaction_type, amount, balance_after)
  values (p_quote_id, 'VOID_REFUND', q.price, new_balance);
  return new_balance;
end;
$$;

revoke all on function public.reserve_quote_for_bol(uuid) from public, anon, authenticated;
revoke all on function public.complete_quote_bol(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.release_quote_bol_reservation(uuid) from public, anon, authenticated;
revoke all on function public.void_quote_and_refund(uuid) from public, anon, authenticated;
