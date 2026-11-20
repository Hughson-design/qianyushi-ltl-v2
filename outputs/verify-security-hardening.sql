begin;

create temp table saved_quotes (
  id uuid primary key, customer_id uuid not null, price numeric not null,
  status text not null, updated_at timestamptz
) on commit drop;
create temp table deposit_accounts (
  customer_id uuid primary key, available_balance numeric not null, updated_at timestamptz
) on commit drop;
create temp table deposit_transactions (
  seq bigint generated always as identity, quote_id uuid, customer_id uuid, actor_user_id uuid,
  transaction_type text, amount numeric, balance_after numeric, idempotency_key text unique
) on commit drop;

do $$
declare
  definition text;
  signature regprocedure;
  customer uuid := gen_random_uuid();
  quote uuid := gen_random_uuid();
begin
  for signature in select unnest(array[
    'public.reserve_quote_for_bol(uuid,uuid,uuid)'::regprocedure,
    'public.release_quote_bol_reservation(uuid,uuid,uuid)'::regprocedure
  ]) loop
    definition := pg_get_functiondef(signature);
    execute replace(definition, 'public.', 'pg_temp.');
  end loop;

  insert into pg_temp.deposit_accounts values (customer, 1000, now());
  insert into pg_temp.saved_quotes values (quote, customer, 125.50, 'draft', now());
  perform pg_temp.reserve_quote_for_bol(quote, customer, null);
  perform pg_temp.release_quote_bol_reservation(quote, customer, null);
  perform pg_temp.reserve_quote_for_bol(quote, customer, null);
  perform pg_temp.release_quote_bol_reservation(quote, customer, null);
  perform pg_temp.release_quote_bol_reservation(quote, customer, null);

  if (select available_balance from pg_temp.deposit_accounts where customer_id = customer) is distinct from 1000::numeric
    or (select status from pg_temp.saved_quotes where id = quote) is distinct from 'draft'
    or (select array_agg(amount order by seq) from pg_temp.deposit_transactions)
      is distinct from array[-125.50, 125.50, -125.50, 125.50]::numeric[]
    or (select array_agg(balance_after order by seq) from pg_temp.deposit_transactions)
      is distinct from array[874.50, 1000.00, 874.50, 1000.00]::numeric[]
    or (select count(distinct idempotency_key) from pg_temp.deposit_transactions) <> 4
  then
    raise exception 'Booking retry ledger verification failed';
  end if;
end;
$$;

select seq, transaction_type, amount, balance_after from pg_temp.deposit_transactions order by seq;
do $$
declare i integer;
begin
  for i in 1..10 loop
    if not public.consume_login_attempt(repeat('a',64),repeat('b',64)) then raise exception 'Login limit rejected early'; end if;
  end loop;
  if public.consume_login_attempt(repeat('a',64),repeat('b',64)) then raise exception 'Login limit not enforced'; end if;
  if has_function_privilege('anon','public.consume_login_attempt(text,text)','EXECUTE') or has_function_privilege('authenticated','public.consume_login_attempt(text,text)','EXECUTE') then raise exception 'Throttle function exposed'; end if;
end;
$$;
rollback;
