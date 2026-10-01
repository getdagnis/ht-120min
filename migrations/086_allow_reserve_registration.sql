BEGIN;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS allow_reserve_registration boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tournaments.allow_reserve_registration IS
  'Whether new teams may join this tournament reserve list; independent of participant registration.';

COMMIT;

--applied!