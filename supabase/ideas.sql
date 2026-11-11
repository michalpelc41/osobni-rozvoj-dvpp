create table public.dvpp_ideas (
  id uuid primary key default gen_random_uuid(),
  author_id uuid default auth.uid() references public.dvpp_profiles(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  format text not null check (format in (
    'Konference', 'Přednáška', 'Seminář', 'Workshop', 'Metodické setkání',
    'On-line zdroj', 'E-learning', 'Publikace'
  )),
  description text not null check (length(btrim(description)) between 1 and 10000),
  url text not null default '' check (length(url) <= 2000 and (url = '' or url ~* '^https?://[^[:space:]]+$')),
  created_at timestamptz not null default now()
);

create index dvpp_ideas_author_idx on public.dvpp_ideas (author_id);
alter table public.dvpp_ideas enable row level security;
revoke all on public.dvpp_ideas from public, anon, authenticated;
grant select, delete on public.dvpp_ideas to authenticated;
grant insert (title, format, description, url), update (title, format, description, url)
  on public.dvpp_ideas to authenticated;

create policy ideas_team_read on public.dvpp_ideas
  for select to authenticated using ((select dvpp_private.is_team_member()));
create policy ideas_team_insert on public.dvpp_ideas
  for insert to authenticated with check (
    (select dvpp_private.is_team_member()) and author_id = (select auth.uid())
  );
create policy ideas_team_update on public.dvpp_ideas
  for update to authenticated
  using ((select dvpp_private.is_team_member()))
  with check ((select dvpp_private.is_team_member()));
create policy ideas_team_delete on public.dvpp_ideas
  for delete to authenticated using ((select dvpp_private.is_team_member()));
