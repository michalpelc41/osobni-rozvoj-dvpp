alter table public.dvpp_team_members add column auto_approved boolean not null default false;
create function dvpp_private.sync_verified_kcv_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.email_confirmed_at is not null and new.email ~* '^[^@[:space:]]+@kcv[.]cz$' then
  update public.dvpp_team_members set approved=true, auto_approved=true where user_id=new.id;
 else
  update public.dvpp_team_members set approved=case when auto_approved then false else approved end,auto_approved=false where user_id=new.id;
 end if;
 return new;
end;
$$;
revoke all on function dvpp_private.sync_verified_kcv_member() from public,anon,authenticated;
create trigger zz_dvpp_sync_verified_email after insert or update of email,email_confirmed_at on auth.users for each row execute function dvpp_private.sync_verified_kcv_member();
update public.dvpp_team_members m set approved=true,auto_approved=true from auth.users u where m.user_id=u.id and u.email_confirmed_at is not null and u.email ~* '^[^@[:space:]]+@kcv[.]cz$';
