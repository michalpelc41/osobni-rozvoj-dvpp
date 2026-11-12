create or replace function public.dvpp_validate_review_job(p_token text, p_week date) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from dvpp_private.idea_review_settings where cron_token = p_token)
    and not exists (
      select 1 from public.dvpp_idea_review_runs where week = p_week and summary->>'selection' = 'dvpp-expanded'
    );
$$;

create or replace function public.dvpp_save_review_run(p_week date, p_summary jsonb, p_items jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  review_run uuid;
  already_suggested integer;
  added integer;
begin
  if p_summary->>'mode' is distinct from 'external'
    or p_summary->>'selection' is distinct from 'dvpp-expanded' then return 0; end if;

  insert into public.dvpp_idea_review_runs as runs (week, summary) values (p_week, p_summary)
    on conflict (week) do update set summary = excluded.summary, checked_at = now()
      where runs.summary->>'selection' is distinct from 'dvpp-expanded'
    returning id into review_run;
  if review_run is null then return 0; end if;

  select count(*) into already_suggested from public.dvpp_idea_review_items
    where run_id = review_run and kind = 'new' and public.dvpp_is_external_idea_url(source);

  insert into public.dvpp_idea_review_items(run_id, kind, title, proposed, source, note, fingerprint)
  select review_run, 'new', item.title, item.proposed, item.source, item.note, item.fingerprint
    from jsonb_to_recordset(p_items) as item(kind text, title text, proposed jsonb, source text, note text, fingerprint text)
    where item.kind = 'new' and public.dvpp_is_external_idea_url(item.source)
      and public.dvpp_is_external_idea_url(item.proposed->>'url')
    limit greatest(0, 10 - already_suggested)
    on conflict (fingerprint) do nothing;
  get diagnostics added = row_count;

  update public.dvpp_idea_review_runs set summary = jsonb_set(summary, '{suggested}', to_jsonb(already_suggested + added))
    where id = review_run;
  return added;
end;
$$;
