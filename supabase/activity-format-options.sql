alter table public.dvpp_activities
  drop constraint dvpp_activities_format_check,
  add constraint dvpp_activities_format_check
    check (format in (
      'Konference', 'Přednáška', 'Seminář', 'Workshop', 'Metodické setkání',
      'On-line zdroj', 'E-learning', 'Publikace',
      'Webinář', 'Online kurz', 'Článek', 'Kniha', 'Jiné'
    ));
