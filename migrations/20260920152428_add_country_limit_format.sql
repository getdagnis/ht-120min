-- Distinguish CountryID restrictions from historical LeagueID restrictions.
-- Existing rows remain unmarked because their original numeric namespace cannot
-- be inferred safely from country_limit alone. The Exotic campaign is known to
-- have been seeded with current CountryIDs and is marked explicitly.

alter table public.tournaments
  add column if not exists country_limit_format text;

alter table public.tournaments
  drop constraint if exists tournaments_country_limit_format_check;

alter table public.tournaments
  add constraint tournaments_country_limit_format_check
  check (country_limit_format is null or country_limit_format in ('country_id', 'league_id'));

update public.tournaments
set country_limit_format = 'country_id'
where slug in (
  'queens-of-the-pacific-cup',
  'exotic-hfi-saint-kitts-and-nevis',
  'exotic-hfi-gibraltar',
  'exotic-hfi-liechtenstein',
  'exotic-hfi-san-marino',
  'exotic-hfi-andorra',
  'exotic-hfi-faroe-islands',
  'exotic-hfi-saint-vincent-and-the-grenadines',
  'exotic-hfi-tahiti',
  'exotic-hfi-curacao',
  'exotic-hfi-sao-tome-e-principe',
  'exotic-hfi-barbados',
  'exotic-hfi-bahamas',
  'exotic-hfi-maldives',
  'exotic-hfi-bhutan',
  'exotic-hfi-cabo-verde',
  'exotic-hfi-malta',
  'exotic-hfi-suriname',
  'exotic-hfi-brunei',
  'exotic-hfi-comoros',
  'exotic-hfi-trinidad-tobago'
);
