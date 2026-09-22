ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS include_week15_weekend_friendly BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS league_level INTEGER;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_slot_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_schedule_slot_type_check'
  ) THEN
    ALTER TABLE matches
      ADD CONSTRAINT matches_schedule_slot_type_check
      CHECK (schedule_slot_type IS NULL OR schedule_slot_type IN ('midweek_friendly', 'weekend_friendly'));
  END IF;
END $$;

-- MIGRATION APPLIED!