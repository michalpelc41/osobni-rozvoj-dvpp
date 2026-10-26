-- Samostatné tabulky DVPP; stávající aplikace a jejich data se nemění.
begin;
create schema if not exists dvpp_private;
revoke all on schema dvpp_private from public;
grant usage on schema dvpp_private to authenticated;
create table public.dvpp_team_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 approved boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.dvpp_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (length(btrim(display_name)) between 1 and 100)
);
create function dvpp_private.is_team_member() returns boolean language sql stable security definer
set search_path = '' as $$
 select exists(select 1 from public.dvpp_team_members where user_id=(select auth.uid()) and approved);
$$;
revoke all on function dvpp_private.is_team_member() from public, anon;
grant execute on function dvpp_private.is_team_member() to authenticated;
create function dvpp_private.handle_new_dvpp_user() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
 insert into public.dvpp_profiles(id,display_name) values(new.id,coalesce(nullif(left(btrim(new.raw_user_meta_data->>'display_name'),100),''),'Garant DVPP'));
 insert into public.dvpp_team_members(user_id) values(new.id);
 return new;
end;
$$;
revoke all on function dvpp_private.handle_new_dvpp_user() from public, anon, authenticated;
create trigger on_dvpp_user_created after insert on auth.users for each row execute function dvpp_private.handle_new_dvpp_user();
insert into public.dvpp_profiles(id,display_name)
select id,coalesce(nullif(left(btrim(raw_user_meta_data->>'display_name'),100),''),'Garant DVPP') from auth.users;
insert into public.dvpp_team_members(user_id) select id from auth.users;
create table public.dvpp_activities (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references public.dvpp_profiles(id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 200),
 activity_date date not null,
 format text not null check(format in ('Seminář','Webinář','Online kurz','Článek','Konference','Jiné')),
 location text not null check(length(btrim(location)) between 1 and 500),
 url text not null default '' check(length(url)<=2000 and (url='' or url ~* '^https?://[^[:space:]]+$')),
 description text not null check(length(btrim(description)) between 1 and 10000),
 reflection text not null default '' check(length(reflection)<=10000),
 cost numeric(12,2) not null default 0 check(cost between 0 and 99999999),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index dvpp_activities_date_idx on public.dvpp_activities(activity_date);
create index dvpp_activities_user_date_idx on public.dvpp_activities(user_id,activity_date);
create function dvpp_private.validate_dvpp_activity() returns trigger language plpgsql set search_path = '' as $$
begin
 if TG_OP='UPDATE' then
  if new.user_id is distinct from old.user_id or new.id is distinct from old.id or new.created_at is distinct from old.created_at then
   raise exception 'Autor a identita aktivity se nesmí měnit.';
  end if;
 end if;
 if length(btrim(new.reflection))>0 and new.activity_date>(now() at time zone 'Europe/Prague')::date then
  raise exception 'Reflexi lze doplnit až po absolvování aktivity.';
 end if;
 new.updated_at=now(); return new;
end;
$$;
create trigger validate_dvpp_activity before insert or update on public.dvpp_activities for each row execute function dvpp_private.validate_dvpp_activity();
alter table public.dvpp_team_members enable row level security;
alter table public.dvpp_profiles enable row level security;
alter table public.dvpp_activities enable row level security;
revoke all on public.dvpp_team_members, public.dvpp_profiles, public.dvpp_activities from anon, authenticated;
grant select on public.dvpp_team_members to authenticated;
grant select on public.dvpp_profiles to authenticated;
grant update(display_name) on public.dvpp_profiles to authenticated;
grant select,insert,update,delete on public.dvpp_activities to authenticated;
create policy membership_self_read on public.dvpp_team_members for select to authenticated using(user_id=(select auth.uid()));
create policy profiles_team_read on public.dvpp_profiles for select to authenticated using(id=(select auth.uid()) or (select dvpp_private.is_team_member()));
create policy profiles_self_update on public.dvpp_profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy activities_team_read on public.dvpp_activities for select to authenticated using((select dvpp_private.is_team_member()));
create policy activities_owner_insert on public.dvpp_activities for insert to authenticated with check((select dvpp_private.is_team_member()) and user_id=(select auth.uid()));
create policy activities_owner_update on public.dvpp_activities for update to authenticated using((select dvpp_private.is_team_member()) and user_id=(select auth.uid())) with check((select dvpp_private.is_team_member()) and user_id=(select auth.uid()));
create policy activities_owner_delete on public.dvpp_activities for delete to authenticated using((select dvpp_private.is_team_member()) and user_id=(select auth.uid()));
-- Realtime umožňuje promítnout změny ostatním přihlášeným členům.
alter publication supabase_realtime add table public.dvpp_activities;
commit;
