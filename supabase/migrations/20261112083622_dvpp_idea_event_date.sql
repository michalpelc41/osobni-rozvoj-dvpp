alter table public.dvpp_ideas add column if not exists event_date date;

grant insert (event_date), update (event_date) on public.dvpp_ideas to authenticated;
