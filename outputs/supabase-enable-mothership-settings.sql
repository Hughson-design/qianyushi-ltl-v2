begin;

alter table public.platform_settings
  add column if not exists mothership_enabled boolean not null default true;

commit;
