create or replace function dvpp_private.handle_new_dvpp_user() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
 insert into public.dvpp_profiles(id,display_name) values(new.id,coalesce(nullif(left(btrim(new.raw_user_meta_data->>'display_name'),100),''),nullif(left(new.email,100),''),'Jméno není doplněné'));
 insert into public.dvpp_team_members(user_id) values(new.id);
 return new;
end;
$$;
revoke all on function dvpp_private.handle_new_dvpp_user() from public,anon,authenticated;
