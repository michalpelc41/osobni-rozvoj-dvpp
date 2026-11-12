create extension if not exists http with schema extensions;

create function dvpp_private.run_idea_review() returns integer
language plpgsql set search_path = ''
as $$
declare
  token text;
  response_status integer;
begin
  select cron_token into strict token from dvpp_private.idea_review_settings;
  select status into response_status from extensions.http(row(
    'POST',
    'https://bdpohvxdnccnkmmxiaid.supabase.co/functions/v1/dvpp-review',
    array[extensions.http_header('X-DVPP-Job', token)],
    'application/json',
    '{}'
  )::extensions.http_request);
  if response_status = 403 and exists (
    select 1 from public.dvpp_idea_review_runs
    where week = date_trunc('week', timezone('Europe/Prague', now()))::date
  ) then return 200; end if;
  if response_status <> 202 then
    raise exception 'Kontrola inspirací vrátila HTTP %', response_status;
  end if;
  return response_status;
end;
$$;

revoke all on function dvpp_private.run_idea_review() from public, anon, authenticated;
select cron.schedule('dvpp-idea-review-weekly', '15 6 * * 1', 'select dvpp_private.run_idea_review()');
create or replace function dvpp_private.queue_idea_review() returns bigint
language sql set search_path = ''
as $$ select dvpp_private.run_idea_review()::bigint; $$;
