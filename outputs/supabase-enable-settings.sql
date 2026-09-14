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

comment on table public.platform_settings is
  'Single-account platform profile and booking defaults. Accessed only by the application server secret key.';
