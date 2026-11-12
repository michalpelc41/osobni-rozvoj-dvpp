create extension if not exists pg_cron;
create extension if not exists pg_net;

create function dvpp_private.queue_idea_review() returns bigint
language sql set search_path = ''
as $$
  select net.http_post(
    url := 'https://bdpohvxdnccnkmmxiaid.supabase.co/functions/v1/dvpp-review',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-DVPP-Job', cron_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) from dvpp_private.idea_review_settings;
$$;

revoke all on function dvpp_private.queue_idea_review() from public, anon, authenticated;
select cron.schedule('dvpp-idea-review-weekly', '15 6 * * 1', 'select dvpp_private.queue_idea_review()');
