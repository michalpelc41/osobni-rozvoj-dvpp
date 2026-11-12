create function public.dvpp_can_review_ideas() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = (select auth.uid()) and lower(email) = 'pelc@kcv.cz'
      and email_confirmed_at is not null
  ) and dvpp_private.is_team_member();
$$;

create table public.dvpp_idea_review_runs (
  id uuid primary key default gen_random_uuid(),
  week date unique not null,
  checked_at timestamptz not null default now(),
  summary jsonb not null
);

create table public.dvpp_idea_review_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.dvpp_idea_review_runs(id),
  idea_id uuid,
  kind text not null check (kind in ('change', 'new', 'manual')),
  title text not null,
  field text,
  original jsonb,
  proposed jsonb,
  source text not null,
  note text not null default '',
  fingerprint text not null unique,
  checked_at timestamptz not null default now(),
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'rejected')),
  decided_at timestamptz
);

create index dvpp_idea_review_items_pending on public.dvpp_idea_review_items(checked_at desc)
  where decision = 'pending';

alter table public.dvpp_idea_review_runs enable row level security;
alter table public.dvpp_idea_review_items enable row level security;
revoke all on public.dvpp_idea_review_runs, public.dvpp_idea_review_items from public, anon, authenticated;
grant select on public.dvpp_idea_review_runs, public.dvpp_idea_review_items to authenticated;
grant select on public.dvpp_idea_review_items to service_role;

create policy idea_review_runs_owner on public.dvpp_idea_review_runs
  for select to authenticated using ((select public.dvpp_can_review_ideas()));
create policy idea_review_items_owner on public.dvpp_idea_review_items
  for select to authenticated using ((select public.dvpp_can_review_ideas()));

create table dvpp_private.idea_review_settings (
  singleton boolean primary key default true check (singleton),
  cron_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table dvpp_private.idea_review_settings enable row level security;
revoke all on dvpp_private.idea_review_settings from public, anon, authenticated;
insert into dvpp_private.idea_review_settings default values;

create function public.dvpp_validate_review_job(p_token text, p_week date) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from dvpp_private.idea_review_settings where cron_token = p_token)
    and not exists (select 1 from public.dvpp_idea_review_runs where week = p_week);
$$;

create function public.dvpp_save_review_run(p_week date, p_summary jsonb, p_items jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  review_run uuid;
  added integer;
begin
  insert into public.dvpp_idea_review_runs(week, summary) values (p_week, p_summary)
    on conflict (week) do nothing returning id into review_run;
  if review_run is null then return 0; end if;

  insert into public.dvpp_idea_review_items(run_id, idea_id, kind, title, field, original, proposed, source, note, fingerprint)
  select review_run, item.idea_id, item.kind, item.title, item.field, item.original, item.proposed, item.source, item.note, item.fingerprint
    from jsonb_to_recordset(p_items) as item(idea_id uuid, kind text, title text, field text, original jsonb,
      proposed jsonb, source text, note text, fingerprint text)
    on conflict (fingerprint) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

create function public.dvpp_decide_idea_review(p_id uuid, p_approve boolean, p_edits jsonb default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  item public.dvpp_idea_review_items%rowtype;
  idea public.dvpp_ideas%rowtype;
  payload jsonb;
  published_url text;
begin
  if not public.dvpp_can_review_ideas() then
    raise exception 'Přístup je omezený.' using errcode = '42501';
  end if;
  select * into item from public.dvpp_idea_review_items where id = p_id for update;
  if not found or item.decision <> 'pending' then return 'resolved'; end if;

  if p_approve is true then
    if item.kind = 'change' then
      select * into idea from public.dvpp_ideas where id = item.idea_id for update;
      if not found or (
        idea.url is distinct from item.source and not exists (
          select 1 from public.dvpp_idea_review_items as redirect
          where redirect.run_id = item.run_id and redirect.idea_id = idea.id
            and redirect.field = 'url' and redirect.decision = 'approved'
            and redirect.source = item.source and redirect.proposed #>> '{}' = idea.url
        )
      ) or (to_jsonb(idea) -> item.field) is distinct from coalesce(item.original, 'null'::jsonb) then
        return 'conflict';
      end if;

      case item.field
        when 'title' then update public.dvpp_ideas set title = item.proposed #>> '{}' where id = idea.id;
        when 'description' then update public.dvpp_ideas set description = item.proposed #>> '{}' where id = idea.id;
        when 'event_date' then update public.dvpp_ideas set event_date = (item.proposed #>> '{}')::date where id = idea.id;
        when 'url' then
          update public.dvpp_ideas set url = item.proposed #>> '{}' where id = idea.id;
        else return 'invalid';
      end case;
    elsif item.kind = 'new' then
      payload := coalesce(p_edits, item.proposed);
      published_url := coalesce(payload->>'url', '');
      if published_url !~* '^https?://[^[:space:]]+$' then return 'invalid'; end if;

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
    else
      return 'invalid';
    end if;
  end if;

  update public.dvpp_idea_review_items
    set decision = case when p_approve is true then 'approved' else 'rejected' end, decided_at = now()
    where id = p_id;
  return case when p_approve is true then 'approved' else 'rejected' end;
end;
$$;

revoke all on function public.dvpp_can_review_ideas(), public.dvpp_decide_idea_review(uuid,boolean,jsonb),
  public.dvpp_validate_review_job(text,date), public.dvpp_save_review_run(date,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.dvpp_can_review_ideas(), public.dvpp_decide_idea_review(uuid,boolean,jsonb) to authenticated;
grant execute on function public.dvpp_validate_review_job(text,date), public.dvpp_save_review_run(date,jsonb,jsonb) to service_role;
