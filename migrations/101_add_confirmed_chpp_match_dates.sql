alter table public.matches
  add column if not exists chpp_match_date timestamptz;

comment on column public.matches.chpp_match_date is
  'Exact Hattrick CHPP MatchDate parsed from Europe/Stockholm wall-clock time and stored as a UTC instant. Null means the fixture only has its planned/estimated scheduled_for time.';

-- applied!