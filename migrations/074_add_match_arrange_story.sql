ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS next_match_arrange_story JSONB;

COMMENT ON COLUMN public.matches.next_match_arrange_story IS
  'Snapshot of the editorial arranged-fixture activity story and its transition timestamp.';

-- migration applied by user!
