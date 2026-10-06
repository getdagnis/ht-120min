ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS join_story JSONB;

-- applied!

