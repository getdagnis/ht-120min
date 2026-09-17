BEGIN;

ALTER TABLE public.news_posts
  ADD COLUMN IF NOT EXISTS season_number INTEGER;

UPDATE public.news_posts
SET season_number = 1
WHERE season_number IS NULL;

ALTER TABLE public.news_posts
  ALTER COLUMN season_number SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_news_posts_tournament_season_created
  ON public.news_posts(tournament_id, season_number, created_at DESC);

COMMIT;
