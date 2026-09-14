create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  company_name text not null default 'Shenzhen Qianyushi Supply Chain Service Co.,Ltd.',
  contact_name text not null default 'Cathy Huang',
  email text not null default '',
  phone text not null default '',
  default_ready_time text not null default '09:00',
  default_close_time text not null default '16:00',
  markup_percent numeric(8, 3) not null default 0 check (markup_percent >= 0),
  minimum_markup numeric(12, 2) not null default 0 check (minimum_markup >= 0),
  wwex_enabled boolean not null default true,
  priority1_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings
  add column if not exists markup_percent numeric(8, 3) not null default 0,
  add column if not exists minimum_markup numeric(12, 2) not null default 0,
  add column if not exists wwex_enabled boolean not null default true,
  add column if not exists priority1_enabled boolean not null default true;

insert into public.platform_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
revoke all on table public.platform_settings from anon, authenticated;

alter table public.deposit_transactions
  alter column quote_id drop not null,
  add column if not exists reason text not null default '';

alter table public.deposit_transactions
  drop constraint if exists deposit_transactions_transaction_type_check;

alter table public.deposit_transactions
  add constraint deposit_transactions_transaction_type_check
  check (transaction_type in ('DEPOSIT', 'ADJUSTMENT', 'BOL_RESERVE', 'BOOKING_RELEASE', 'VOID_REFUND'));

create or replace function public.adjust_deposit_balance(p_amount numeric, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(12, 2);
begin
  if p_amount = 0 then raise exception 'Amount cannot be zero'; end if;
  if trim(coalesce(p_reason, '')) = '' then raise exception 'Reason is required'; end if;

  update public.deposit_accounts
  set available_balance = available_balance + p_amount, updated_at = now()
  where id = true and available_balance + p_amount >= 0
  returning available_balance into new_balance;

  if new_balance is null then raise exception 'Adjustment would make the deposit balance negative'; end if;

  insert into public.deposit_transactions (quote_id, transaction_type, amount, balance_after, reason)
  values (null, case when p_amount > 0 then 'DEPOSIT' else 'ADJUSTMENT' end, p_amount, new_balance, trim(p_reason));

  return new_balance;
end;
$$;

revoke all on function public.adjust_deposit_balance(numeric, text) from public, anon, authenticated;
