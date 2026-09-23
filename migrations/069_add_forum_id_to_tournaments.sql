-- Optional Hattrick forum thread associated with a tournament.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS forum_id BIGINT;

COMMENT ON COLUMN public.tournaments.forum_id IS
  'Optional Hattrick forum thread ID for the tournament discussion link.';

-- applied!