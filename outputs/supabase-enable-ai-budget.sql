begin;
create table if not exists public.reader_ai_days (
  day date primary key, used bigint not null default 0 check (used >= 0),
  reserved bigint not null default 0 check (reserved >= 0), blocked boolean not null default false
);
create table if not exists public.reader_ai_requests (
  id uuid primary key, day date not null references public.reader_ai_days(day),
  reserved integer not null check (reserved > 0), actual integer,
  settled boolean not null default false, created_at timestamptz not null default now()
);
alter table public.reader_ai_days enable row level security;
alter table public.reader_ai_requests enable row level security;
revoke all on public.reader_ai_days, public.reader_ai_requests from public, anon, authenticated;

create or replace function public.reader_ai_quota()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'UTC')::date; q public.reader_ai_days%rowtype;
begin
  insert into public.reader_ai_days(day) values(d) on conflict do nothing;
  select * into q from public.reader_ai_days where day = d;
  return jsonb_build_object('day',d,'used',q.used,'reserved',q.reserved,'limit',200000,
    'remaining',greatest(0,200000-q.used-q.reserved),'blocked',q.blocked,
    'resetAt',((d+1)::timestamp at time zone 'UTC'));
end;
$$;

create or replace function public.reserve_reader_ai_tokens(p_id uuid,p_tokens integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'UTC')::date; q public.reader_ai_days%rowtype;
begin
  if p_tokens is null or p_tokens <= 0 then raise exception 'Invalid reservation'; end if;
  insert into public.reader_ai_days(day) values(d) on conflict do nothing;
  select * into q from public.reader_ai_days where day = d for update;
  if exists(select 1 from public.reader_ai_requests where id=p_id) then raise exception 'Duplicate reservation'; end if;
  if q.blocked or q.used+q.reserved+p_tokens > 200000 then
    return jsonb_build_object('allowed',false,'quota',public.reader_ai_quota());
  end if;
  insert into public.reader_ai_requests(id,day,reserved) values(p_id,d,p_tokens);
  update public.reader_ai_days set reserved=reserved+p_tokens where day=d;
  return jsonb_build_object('allowed',true,'id',p_id,'quota',public.reader_ai_quota());
end;
$$;

create or replace function public.settle_reader_ai_tokens(p_id uuid,p_actual integer default null,p_block boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.reader_ai_requests%rowtype; amount integer;
begin
  select * into r from public.reader_ai_requests where id=p_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if not r.settled then
    amount := coalesce(p_actual,r.reserved);
    if amount < 0 then raise exception 'Invalid usage'; end if;
    update public.reader_ai_days set reserved=reserved-r.reserved,used=used+amount,
      blocked=blocked or p_block or amount>r.reserved where day=r.day;
    update public.reader_ai_requests set actual=amount,settled=true where id=p_id;
  end if;
  return public.reader_ai_quota();
end;
$$;
revoke all on function public.reader_ai_quota() from public, anon, authenticated;
revoke all on function public.reserve_reader_ai_tokens(uuid,integer) from public, anon, authenticated;
revoke all on function public.settle_reader_ai_tokens(uuid,integer,boolean) from public, anon, authenticated;
grant execute on function public.reader_ai_quota() to service_role;
grant execute on function public.reserve_reader_ai_tokens(uuid,integer) to service_role;
grant execute on function public.settle_reader_ai_tokens(uuid,integer,boolean) to service_role;
commit;
