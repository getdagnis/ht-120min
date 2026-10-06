-- The live CHPP poll can positively identify a match in progress. Preserve
-- that state instead of forcing it back to arranged between refreshes.
ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_status_check;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('not_arranged', 'arranged', 'ongoing', 'misarranged', 'finished'));

-- applied!