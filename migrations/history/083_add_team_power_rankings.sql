-- Persist the PowerRating block returned by CHPP teamdetails alongside TeamRank.
BEGIN;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS power_rating INTEGER,
  ADD COLUMN IF NOT EXISTS power_global_rank INTEGER,
  ADD COLUMN IF NOT EXISTS power_league_rank INTEGER,
  ADD COLUMN IF NOT EXISTS power_region_rank INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.teams'::regclass
      AND conname = 'teams_power_rating_nonnegative'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_power_rating_nonnegative
      CHECK (power_rating IS NULL OR power_rating >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.teams'::regclass
      AND conname = 'teams_power_global_rank_nonnegative'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_power_global_rank_nonnegative
      CHECK (power_global_rank IS NULL OR power_global_rank >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.teams'::regclass
      AND conname = 'teams_power_league_rank_nonnegative'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_power_league_rank_nonnegative
      CHECK (power_league_rank IS NULL OR power_league_rank >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.teams'::regclass
      AND conname = 'teams_power_region_rank_nonnegative'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_power_region_rank_nonnegative
      CHECK (power_region_rank IS NULL OR power_region_rank >= 0);
  END IF;
END $$;

COMMIT;


-- applied!