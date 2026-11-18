begin;
alter table public.quote_input_history add column if not exists user_name text not null default '';
create index if not exists quote_input_history_customer_sequence_idx
  on public.quote_input_history (customer_id, id desc);
commit;
