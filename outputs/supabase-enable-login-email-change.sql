begin;

alter table public.app_users add column if not exists requested_email text;

create or replace function public.sync_confirmed_login_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.app_users
  set email = pg_catalog.lower(new.email),
      requested_email = null,
      updated_at = pg_catalog.now()
  where user_id = new.id;
  return new;
end;
$$;

revoke execute on function public.sync_confirmed_login_email() from public;

drop trigger if exists sync_confirmed_login_email on auth.users;
create trigger sync_confirmed_login_email
after update of email on auth.users
for each row when (new.email is not null and old.email is distinct from new.email)
execute function public.sync_confirmed_login_email();

commit;
