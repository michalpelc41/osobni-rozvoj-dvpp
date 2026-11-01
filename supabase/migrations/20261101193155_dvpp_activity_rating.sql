alter table public.dvpp_activities add column rating smallint check (rating between 1 and 5);
comment on column public.dvpp_activities.rating is 'Volitelné celkové hodnocení přínosu aktivity autorem, 1 až 5 hvězdiček.';
create function dvpp_private.validate_dvpp_rating() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.rating is not null and new.activity_date > (now() at time zone 'Europe/Prague')::date then
  raise exception 'Hodnocení lze doplnit až po absolvování aktivity.';
 end if;
 return new;
end;
$$;
create trigger validate_dvpp_rating before insert or update on public.dvpp_activities for each row execute function dvpp_private.validate_dvpp_rating();
