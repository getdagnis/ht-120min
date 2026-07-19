ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS appg_outcome text NOT NULL DEFAULT 'needs_review',
  ADD COLUMN IF NOT EXISTS appg_outcome_source text NOT NULL DEFAULT 'unclassified';

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_appg_outcome_check;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_appg_outcome_check
  CHECK (appg_outcome IN ('ET3', 'ET2', 'PS1', 'RT0', 'OPW', 'needs_review'));

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_appg_outcome_source_check;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_appg_outcome_source_check
  CHECK (appg_outcome_source IN ('unclassified', 'chpp', 'organizer', 'csv'));

-- MIGRATION APPLIED!