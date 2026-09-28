-- Persist the authoritative CHPP finish timestamp for played fixtures.
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

COMMENT ON COLUMN public.matches.finished_at IS
  'The CHPP FinishedDate for a completed played match, when available.';

-- applied!
