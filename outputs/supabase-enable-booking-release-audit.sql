begin;
create table if not exists public.booking_release_audit (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  quote_id uuid not null, quote_number text not null, customer_id uuid not null,
  actor_user_id uuid not null, actor_email text not null, actor_name text not null,
  action text not null check(action in ('AUTO_RELEASE','ADMIN_RELEASE')),
  reason text not null check(char_length(reason) between 10 and 1000),
  amount numeric(12,2) not null check(amount > 0), ledger_transaction_id uuid not null unique
);
create index if not exists booking_release_audit_quote_created on public.booking_release_audit(quote_id,created_at desc);
alter table public.booking_release_audit enable row level security;
revoke all on public.booking_release_audit from public,anon,authenticated,service_role;
grant select on public.booking_release_audit to service_role;

create or replace function public.release_unsubmitted_booking(
  p_quote_id uuid,p_customer_id uuid,p_actor_user_id uuid,p_reason text,p_mode text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.saved_quotes%rowtype; actor public.app_users%rowtype;
  balance numeric(12,2); transaction_id uuid:=gen_random_uuid();
begin
  if p_reason is null or char_length(trim(p_reason)) not between 10 and 1000 or p_reason ~ '[[:cntrl:]]' then raise exception 'A release reason of 10 to 1000 characters is required'; end if;
  if p_mode is null or p_mode not in ('automatic','administrator') then raise exception 'Invalid release mode'; end if;
  select * into actor from public.app_users where user_id=p_actor_user_id and active;
  if not found then raise exception 'Active actor required'; end if;
  if p_mode='administrator' and actor.role<>'admin' then raise exception 'Administrator required'; end if;
  if p_mode='automatic' and actor.role<>'admin' and actor.customer_id is distinct from p_customer_id then raise exception 'Customer mismatch'; end if;
  select * into q from public.saved_quotes where id=p_quote_id and customer_id=p_customer_id for update;
  if not found then raise exception 'Quote not found'; end if;
  if q.status='draft' then return jsonb_build_object('released',false,'status',q.status); end if;
  if q.status<>'booking' then raise exception 'Only a pending booking can be released'; end if;
  if coalesce(q.bol_number,'')<>'' or coalesce(q.provider_shipment_id,'')<>'' then raise exception 'Shipment identifiers exist; verify or cancel the shipment instead'; end if;
  if p_mode='administrator' and (q.updated_at is null or q.updated_at>now()-interval '5 minutes') then raise exception 'Wait five minutes before manual release'; end if;
  update public.deposit_accounts set available_balance=available_balance+q.price,updated_at=now()
    where customer_id=p_customer_id returning available_balance into balance;
  if balance is null then raise exception 'Deposit account not found'; end if;
  update public.saved_quotes set status='draft',updated_at=now() where id=p_quote_id;
  insert into public.deposit_transactions(id,quote_id,customer_id,actor_user_id,transaction_type,amount,balance_after,reason,idempotency_key)
    values(transaction_id,q.id,p_customer_id,p_actor_user_id,'BOOKING_RELEASE',q.price,balance,trim(p_reason),'bol-release:'||q.id::text||':'||transaction_id::text);
  insert into public.booking_release_audit(quote_id,quote_number,customer_id,actor_user_id,actor_email,actor_name,action,reason,amount,ledger_transaction_id)
    values(q.id,q.quote_number,p_customer_id,p_actor_user_id,coalesce(actor.email,''),coalesce(actor.full_name,''),case when p_mode='automatic' then 'AUTO_RELEASE' else 'ADMIN_RELEASE' end,trim(p_reason),q.price,transaction_id);
  return jsonb_build_object('released',true,'status','draft','amount',q.price,'balance',balance);
end;
$$;
revoke all on function public.release_unsubmitted_booking(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.release_unsubmitted_booking(uuid,uuid,uuid,text,text) to service_role;
commit;
