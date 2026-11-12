create function public.dvpp_is_external_idea_url(p_url text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    p_url ~* '^https?://[a-z0-9.-]+\.?(:[0-9]+)?([/?#][^[:space:]\\]*)?$'
    and substring(lower(p_url) from '^https?://([a-z0-9.-]+)') !~ '(^|\.)kcv\.cz\.?$',
    false
  );
$$;
revoke all on function public.dvpp_is_external_idea_url(text) from public, anon;
grant execute on function public.dvpp_is_external_idea_url(text) to authenticated;

alter policy idea_review_items_owner on public.dvpp_idea_review_items using (
  (select public.dvpp_can_review_ideas())
  and kind = 'new' and public.dvpp_is_external_idea_url(source)
);
alter policy idea_review_runs_owner on public.dvpp_idea_review_runs using (
  (select public.dvpp_can_review_ideas()) and summary->>'mode' = 'external'
);

create or replace function public.dvpp_validate_review_job(p_token text, p_week date) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from dvpp_private.idea_review_settings where cron_token = p_token)
    and not exists (
      select 1 from public.dvpp_idea_review_runs where week = p_week and summary->>'mode' = 'external'
    );
$$;

create or replace function public.dvpp_save_review_run(p_week date, p_summary jsonb, p_items jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  review_run uuid;
  added integer;
begin
  if p_summary->>'mode' is distinct from 'external' then return 0; end if;

  insert into public.dvpp_idea_review_runs as runs (week, summary) values (p_week, p_summary)
    on conflict (week) do update set summary = excluded.summary, checked_at = now()
      where runs.summary->>'mode' is distinct from 'external'
    returning id into review_run;
  if review_run is null then return 0; end if;

  insert into public.dvpp_idea_review_items(run_id, kind, title, proposed, source, note, fingerprint)
  select review_run, 'new', item.title, item.proposed, item.source, item.note, item.fingerprint
    from jsonb_to_recordset(p_items) as item(kind text, title text, proposed jsonb, source text, note text, fingerprint text)
    where item.kind = 'new' and public.dvpp_is_external_idea_url(item.source)
      and public.dvpp_is_external_idea_url(item.proposed->>'url')
    on conflict (fingerprint) do nothing;
  get diagnostics added = row_count;

  update public.dvpp_idea_review_runs set summary = jsonb_set(summary, '{suggested}', to_jsonb(added))
    where id = review_run;
  return added;
end;
$$;

create or replace function public.dvpp_decide_idea_review(p_id uuid, p_approve boolean, p_edits jsonb default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  item public.dvpp_idea_review_items%rowtype;
  payload jsonb;
  published_url text;
begin
  if not public.dvpp_can_review_ideas() then
    raise exception 'Přístup je omezený.' using errcode = '42501';
  end if;
  select * into item from public.dvpp_idea_review_items where id = p_id for update;
  if not found or item.decision <> 'pending' then return 'resolved'; end if;
  if item.kind <> 'new' or not public.dvpp_is_external_idea_url(item.source) then return 'invalid'; end if;

  if p_approve is true then
    payload := coalesce(p_edits, item.proposed);
    published_url := btrim(payload->>'url');
    if not public.dvpp_is_external_idea_url(published_url) then return 'invalid'; end if;

    perform pg_advisory_xact_lock(62811621);
    if exists (
      select 1 from public.dvpp_ideas
      where lower(btrim(title)) = lower(btrim(payload->>'title'))
        or regexp_replace(split_part(url, '#', 1), '/+$', '') =
           regexp_replace(split_part(published_url, '#', 1), '/+$', '')
    ) then return 'duplicate'; end if;

    insert into public.dvpp_ideas(author_id, title, format, description, url, event_date)
      values (auth.uid(), btrim(payload->>'title'), payload->>'format', btrim(payload->>'description'),
        published_url, nullif(payload->>'event_date', '')::date);
  end if;

  update public.dvpp_idea_review_items
    set decision = case when p_approve is true then 'approved' else 'rejected' end, decided_at = now()
    where id = p_id;
  return case when p_approve is true then 'approved' else 'rejected' end;
end;
$$;
