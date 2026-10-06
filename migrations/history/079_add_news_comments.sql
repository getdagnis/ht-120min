-- Manager-authored comments on tournament news articles.
CREATE TABLE IF NOT EXISTS public.news_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.news_posts(id) ON DELETE CASCADE,
  hattrick_user_id BIGINT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 480),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS news_comments_post_created_idx
  ON public.news_comments(post_id, created_at ASC);

ALTER TABLE public.news_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view news comments" ON public.news_comments;
CREATE POLICY "Anyone can view news comments"
  ON public.news_comments
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.news_comments TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.news_comments FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'news_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.news_comments;
  END IF;
END $$;

-- applied!