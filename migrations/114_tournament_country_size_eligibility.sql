ALTER TABLE public.tournaments
  ADD COLUMN max_country_active_teams integer,
  ADD COLUMN allow_manager_country_size_exception boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT tournaments_max_country_active_teams_positive
    CHECK (max_country_active_teams IS NULL OR max_country_active_teams > 0);

UPDATE public.tournaments
SET max_country_active_teams = 420,
    allow_manager_country_size_exception = true
WHERE slug = 'around-the-world-in-one-twenty';

-- applied!