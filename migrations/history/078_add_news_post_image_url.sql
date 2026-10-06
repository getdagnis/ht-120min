ALTER TABLE public.news_posts
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- applied!