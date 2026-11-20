begin;

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
  values (p_quote_id, p_customer_id, p_actor_user_id, 'BOL_RESERVE', -q.price, new_balance, 'bol-reserve:' || p_quote_id::text || ':' || gen_random_uuid()::text);
  return new_balance;
end;
$$;

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
  values (p_quote_id, p_customer_id, p_actor_user_id, 'BOOKING_RELEASE', q.price, new_balance, 'bol-release:' || p_quote_id::text || ':' || gen_random_uuid()::text);
end;
$$;

revoke all on function public.reserve_quote_for_bol(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_quote_bol_reservation(uuid, uuid, uuid) from public, anon, authenticated;


grant execute on function public.reserve_quote_for_bol(uuid,uuid,uuid) to service_role;
grant execute on function public.release_quote_bol_reservation(uuid,uuid,uuid) to service_role;

create table if not exists public.login_attempt_buckets (
  key text primary key check (length(key) = 64), window_start timestamptz not null, attempts integer not null
);
alter table public.login_attempt_buckets enable row level security;
revoke all on public.login_attempt_buckets from public, anon, authenticated;
create or replace function public.consume_login_attempt(p_ip_key text, p_account_key text)
returns boolean language plpgsql security definer set search_path = public as $$
declare k text; count_now integer; permitted boolean := true;
begin
  if p_ip_key !~ '^[0-9a-f]{64}$' or p_account_key !~ '^[0-9a-f]{64}$' then return false; end if;
  for k in select unnest(array[p_ip_key, p_account_key]) order by 1 loop
    insert into public.login_attempt_buckets as b (key, window_start, attempts) values (k, now(), 1)
    on conflict (key) do update set
      attempts = case when b.window_start <= now() - interval '15 minutes' then 1 else b.attempts + 1 end,
      window_start = case when b.window_start <= now() - interval '15 minutes' then now() else b.window_start end
    returning attempts into count_now;
    if count_now > (case when k = p_account_key then 10 else 30 end) then permitted := false; end if;
  end loop;
  delete from public.login_attempt_buckets where window_start < now() - interval '1 day';
  return permitted;
end;
$$;
revoke all on function public.consume_login_attempt(text,text) from public, anon, authenticated;
grant execute on function public.consume_login_attempt(text,text) to service_role;

commit;
