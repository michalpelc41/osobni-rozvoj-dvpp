-- Private reflection attachments, max. five files of 20 MiB per activity.
create table public.dvpp_attachments (
 id uuid primary key default gen_random_uuid(),
 activity_id uuid not null references public.dvpp_activities(id) on delete cascade,
 user_id uuid not null default auth.uid() references public.dvpp_profiles(id),
 filename text not null check(length(filename) between 1 and 255),
 size_bytes bigint not null check(size_bytes between 1 and 20971520),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/gif','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain')),
 object_path text generated always as (user_id::text || '/' || activity_id::text || '/' || id::text) stored unique,
 created_at timestamptz not null default now()
);
create index dvpp_attachments_activity_idx on public.dvpp_attachments(activity_id);
create index dvpp_attachments_user_idx on public.dvpp_attachments(user_id);
alter table public.dvpp_attachments enable row level security;
revoke all on public.dvpp_attachments from anon, authenticated;
grant select,insert,delete on public.dvpp_attachments to authenticated;
create policy attachments_team_read on public.dvpp_attachments for select to authenticated using ((select dvpp_private.is_team_member()));
create policy attachments_owner_insert on public.dvpp_attachments for insert to authenticated with check ((select dvpp_private.is_team_member()) and user_id=(select auth.uid()) and exists(select 1 from public.dvpp_activities a where a.id=activity_id and a.user_id=(select auth.uid())));
create policy attachments_owner_delete on public.dvpp_attachments for delete to authenticated using ((select dvpp_private.is_team_member()) and user_id=(select auth.uid()));
create function dvpp_private.validate_attachment() returns trigger language plpgsql set search_path='' as $$
declare activity public.dvpp_activities;
begin
 select * into activity from public.dvpp_activities where id=new.activity_id for update;
 if not found or activity.user_id is distinct from auth.uid() or new.user_id is distinct from auth.uid() then raise exception 'Přílohy může přidávat jen autor aktivity.'; end if;
 if activity.activity_date>(now() at time zone 'Europe/Prague')::date then raise exception 'Přílohy lze doplnit až po absolvování aktivity.'; end if;
 if (select count(*) from public.dvpp_attachments where activity_id=new.activity_id)>=5 then raise exception 'Aktivita může obsahovat nejvýše 5 příloh.'; end if;
 return new;
end; $$;
revoke all on function dvpp_private.validate_attachment() from public,anon,authenticated;
create trigger validate_attachment before insert on public.dvpp_attachments for each row execute function dvpp_private.validate_attachment();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('dvpp-reflections','dvpp-reflections',false,20971520,array['image/jpeg','image/png','image/gif','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain']);
create policy reflection_files_team_read on storage.objects for select to authenticated using (bucket_id='dvpp-reflections' and (select dvpp_private.is_team_member()) and exists(select 1 from public.dvpp_attachments f where f.object_path=name));
create policy reflection_files_owner_insert on storage.objects for insert to authenticated with check (bucket_id='dvpp-reflections' and (select dvpp_private.is_team_member()) and exists(select 1 from public.dvpp_attachments f join public.dvpp_activities a on a.id=f.activity_id where f.object_path=name and f.user_id=(select auth.uid()) and a.user_id=(select auth.uid()) and a.activity_date<=(now() at time zone 'Europe/Prague')::date));
create policy reflection_files_owner_delete on storage.objects for delete to authenticated using (bucket_id='dvpp-reflections' and (select dvpp_private.is_team_member()) and exists(select 1 from public.dvpp_attachments f where f.object_path=name and f.user_id=(select auth.uid())));
-- Do not allow activity/metadata deletion to orphan files in Storage.
create function dvpp_private.guard_attachment_delete() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from storage.objects where bucket_id='dvpp-reflections' and name=old.object_path) then raise exception 'Nejprve odeberte soubor z úložiště.'; end if;
 return old;
end; $$;
revoke all on function dvpp_private.guard_attachment_delete() from public,anon,authenticated;
create trigger guard_attachment_delete before delete on public.dvpp_attachments for each row execute function dvpp_private.guard_attachment_delete();
