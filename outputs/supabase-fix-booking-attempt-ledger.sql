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
  values (p_quote_id, p_customer_id, p_actor_user_id, 'BOOKING_RELEASE', q.price, new_balance, 'bol-release:' || p_quote_id::text || ':' || gen_random_uuid()::text);
end;
$$;

drop function if exists public.void_quote_and_refund(uuid);
revoke all on function public.reserve_quote_for_bol(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_quote_bol_reservation(uuid, uuid, uuid) from public, anon, authenticated;

commit;
