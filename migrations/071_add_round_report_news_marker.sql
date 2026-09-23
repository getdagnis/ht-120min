-- A generated cup round report is a single editorial record for one
-- tournament season and round. Normal announcements remain unrestricted.
ALTER TABLE public.news_posts
  ADD COLUMN IF NOT EXISTS round_number INTEGER,
  ADD COLUMN IF NOT EXISTS is_round_report BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.news_posts
  DROP CONSTRAINT IF EXISTS news_posts_round_report_requires_round_number;

ALTER TABLE public.news_posts
  ADD CONSTRAINT news_posts_round_report_requires_round_number
  CHECK (NOT is_round_report OR round_number IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS news_posts_one_round_report_per_round
  ON public.news_posts (tournament_id, season_number, round_number)
  WHERE is_round_report;

-- applied!