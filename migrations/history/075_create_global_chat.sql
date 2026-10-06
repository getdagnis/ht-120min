CREATE TABLE IF NOT EXISTS public.global_chat (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name TEXT NOT NULL,
  author_ht_id BIGINT NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.global_chat ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.global_chat FROM anon, authenticated;
GRANT SELECT ON public.global_chat TO anon, authenticated;

DROP POLICY IF EXISTS "Public can view global chat" ON public.global_chat;
CREATE POLICY "Public can view global chat"
  ON public.global_chat
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE UNIQUE INDEX IF NOT EXISTS global_chat_system_message_key
  ON public.global_chat (author_ht_id, content)
  WHERE author_ht_id = 0;

INSERT INTO public.global_chat (author_name, author_ht_id, content)
VALUES ('HT-120min', 0, 'This is HT-120min chat. Login and say hello to everybody!')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'global_chat'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.global_chat;
  END IF;
END $$;

-- applied!
