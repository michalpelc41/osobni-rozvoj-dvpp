alter table public.dvpp_ideas
  drop constraint dvpp_ideas_format_check,
  add constraint dvpp_ideas_format_check check (
    format in (
      'Konference', 'Přednáška', 'Seminář', 'Workshop', 'Metodické setkání',
      'On-line zdroj', 'E-learning', 'Publikace', 'Vzdělávací akce', 'Vzdělávací zdroj'
    )
  ),
  add constraint dvpp_ideas_resource_date_check check (
    format <> 'Vzdělávací zdroj' or event_date is null
  );
