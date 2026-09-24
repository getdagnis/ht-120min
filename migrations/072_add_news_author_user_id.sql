ALTER TABLE public.news_posts
  ADD COLUMN IF NOT EXISTS author_ht_user_id bigint;

CREATE INDEX IF NOT EXISTS idx_news_posts_author_ht_user_id
  ON public.news_posts(author_ht_user_id);
