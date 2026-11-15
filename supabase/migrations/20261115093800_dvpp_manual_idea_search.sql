create function public.dvpp_save_manual_idea_search(p_week date, p_items jsonb)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  review_run uuid;
  added integer;
begin
  if jsonb_array_length(p_items) = 0 then return 0; end if;

  perform pg_advisory_xact_lock(62811621);
  insert into public.dvpp_idea_review_runs (week, summary)
    values (p_week, '{"mode":"manual"}')
    on conflict (week) do update set week = excluded.week
    returning id into review_run;

  insert into public.dvpp_idea_review_items(run_id, kind, title, proposed, source, note, fingerprint)
  select review_run, 'new', item.title, item.proposed, item.source, item.note, item.fingerprint
    from jsonb_to_recordset(p_items) as item(title text, proposed jsonb, source text, note text, fingerprint text)
    where public.dvpp_is_external_idea_url(item.source)
      and public.dvpp_is_external_idea_url(item.proposed->>'url')
      and not exists (select 1 from public.dvpp_ideas as published
        where lower(btrim(published.title)) = lower(btrim(item.title)))
      and not exists (select 1 from public.dvpp_idea_review_items as previous
        where previous.kind = 'new' and lower(btrim(previous.title)) = lower(btrim(item.title)))
    limit 3
    on conflict (fingerprint) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

grant select, insert, update on public.dvpp_idea_review_runs to service_role;
grant insert on public.dvpp_idea_review_items to service_role;
grant execute on function public.dvpp_is_external_idea_url(text) to service_role;
revoke all on function public.dvpp_save_manual_idea_search(date,jsonb) from public, anon, authenticated;
grant execute on function public.dvpp_save_manual_idea_search(date,jsonb) to service_role;
