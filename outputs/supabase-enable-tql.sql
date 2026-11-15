alter table public.platform_settings
  add column if not exists tql_enabled boolean not null default false;


comment on column public.platform_settings.tql_enabled is
  'Controls whether TQL rates are requested. Enable only after TQL production credentials and an approved test window are configured.';
