-- Migration was deleted after feature step-back then restored for history purposes.

-- ALTER TABLE public.tournaments
--   DROP CONSTRAINT IF EXISTS tournaments_schedule_mode_check;

-- ALTER TABLE public.tournaments
--   ADD CONSTRAINT tournaments_schedule_mode_check
--   CHECK (schedule_mode IS NULL OR schedule_mode IN ('single', 'double', 'recurring', 'observed'));

-- ALTER TABLE public.matches
--   ADD COLUMN IF NOT EXISTS fixture_source text NOT NULL DEFAULT 'generated',
--   ADD COLUMN IF NOT EXISTS counting_mode text NOT NULL DEFAULT 'head_to_head',
--   ADD COLUMN IF NOT EXISTS primary_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
--   ADD COLUMN IF NOT EXISTS actual_ht_home_team_name text,
--   ADD COLUMN IF NOT EXISTS actual_ht_away_team_name text;

-- ALTER TABLE public.matches
--   DROP CONSTRAINT IF EXISTS matches_fixture_source_check;

-- ALTER TABLE public.matches
--   ADD CONSTRAINT matches_fixture_source_check
--   CHECK (fixture_source IN ('generated', 'linked', 'manual_import', 'observed_scan'));

-- ALTER TABLE public.matches
--   DROP CONSTRAINT IF EXISTS matches_counting_mode_check;

-- ALTER TABLE public.matches
--   ADD CONSTRAINT matches_counting_mode_check
--   CHECK (counting_mode IN ('head_to_head', 'single_team'));

-- COMMENT ON COLUMN public.matches.fixture_source IS
--   'How this fixture entered HT-120min: generated schedule, manual HT link, manual import, or observed CHPP scan.';

-- COMMENT ON COLUMN public.matches.counting_mode IS
--   'Whether both sides are tournament participants or only primary_team_id is scored for future single-team competitions.';

-- MIGRATION APPLIED!