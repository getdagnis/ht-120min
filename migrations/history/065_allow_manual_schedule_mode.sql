-- Allow tournaments to use fixtures added one-by-one from Hattrick matches
-- instead of a generated round-robin schedule.
--
-- This supersedes the earlier observed-schedule prototype. If that prototype
-- was already applied locally/production, keep its match metadata columns as
-- harmless forward-compatible fields, but normalize tournament schedule_mode
-- from observed to manual so the final product wording and DB state match.

ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_schedule_mode_check;

UPDATE public.tournaments
SET schedule_mode = 'manual'
WHERE schedule_mode = 'observed';

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_schedule_mode_check
  CHECK (schedule_mode IS NULL OR schedule_mode IN ('single', 'double', 'recurring', 'manual'));

-- MIGRATION APPLIED!