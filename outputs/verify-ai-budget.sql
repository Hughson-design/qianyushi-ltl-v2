begin;
create temp table reader_ai_days (like public.reader_ai_days including all) on commit drop;
create temp table reader_ai_requests (like public.reader_ai_requests including all) on commit drop;
do $$
declare definition text; signature regprocedure; a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); result jsonb;
begin
  for signature in select unnest(array[
    'public.reader_ai_quota()'::regprocedure,
    'public.reserve_reader_ai_tokens(uuid,integer)'::regprocedure,
    'public.settle_reader_ai_tokens(uuid,integer,boolean)'::regprocedure
  ]) loop
    definition := pg_get_functiondef(signature);
    execute replace(definition,'public.','pg_temp.');
  end loop;
  result := pg_temp.reserve_reader_ai_tokens(a,180000);
  if not (result->>'allowed')::boolean then raise exception 'First reservation failed'; end if;
  result := pg_temp.reserve_reader_ai_tokens(b,30000);
  if (result->>'allowed')::boolean then raise exception 'Overspend was allowed'; end if;
  result := pg_temp.settle_reader_ai_tokens(a,10000,false);
  if (result->>'used')::integer <> 10000 or (result->>'remaining')::integer <> 190000 then raise exception 'Actual usage mismatch'; end if;
  result := pg_temp.reserve_reader_ai_tokens(b,190000);
  if not (result->>'allowed')::boolean then raise exception 'Exact remaining allowance failed'; end if;
  result := pg_temp.settle_reader_ai_tokens(b,null,false);
  if (result->>'used')::integer <> 200000 or (result->>'remaining')::integer <> 0 then raise exception 'Uncertain request was not reserved'; end if;
  result := pg_temp.settle_reader_ai_tokens(b,1,false);
  if (result->>'used')::integer <> 200000 then raise exception 'Duplicate settlement changed usage'; end if;
  result := pg_temp.reserve_reader_ai_tokens(gen_random_uuid(),1);
  if (result->>'allowed')::boolean then raise exception 'Daily cap was not enforced'; end if;
  if has_function_privilege('anon','public.reserve_reader_ai_tokens(uuid,integer)','EXECUTE') or has_function_privilege('authenticated','public.reader_ai_quota()','EXECUTE') then raise exception 'Budget functions exposed'; end if;
end;
$$;
select 'AI budget verification passed; all changes rolled back' as result;
rollback;
