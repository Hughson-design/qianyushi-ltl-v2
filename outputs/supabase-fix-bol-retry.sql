alter table public.deposit_transactions
  drop constraint if exists deposit_transactions_quote_id_transaction_type_key;

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

revoke all on function public.release_quote_bol_reservation(uuid) from public, anon, authenticated;
revoke all on function public.void_quote_and_refund(uuid) from public, anon, authenticated;
