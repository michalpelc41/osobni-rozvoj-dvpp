alter table public.dvpp_activities
  drop constraint dvpp_activities_format_check,
  add constraint dvpp_activities_format_check
    check (format in ('Seminář', 'Webinář', 'Online kurz', 'Článek', 'Konference', 'Publikace', 'Kniha', 'Jiné'));
