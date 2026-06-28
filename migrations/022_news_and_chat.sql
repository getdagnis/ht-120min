-- 022_news_and_chat.sql
-- Idempotent migration to set up news and chat tables

-- -- Drop existing tables to ensure clean state
-- DROP TABLE IF EXISTS news_reactions;
-- DROP TABLE IF EXISTS news_posts;
-- DROP TABLE IF EXISTS tournament_chat;

-- News Table
CREATE TABLE news_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  author_name TEXT NOT NULL,
  author_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  title TEXT, -- Added for article style
  content TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reactions Table
CREATE TABLE news_reactions (
  post_id UUID REFERENCES news_posts(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT NOT NULL,
  reaction TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- Chat Table
CREATE TABLE tournament_chat (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE news_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_chat ENABLE ROW LEVEL SECURITY;

-- Public policies
CREATE POLICY "Anyone can view news" ON news_posts FOR SELECT USING (true);
CREATE POLICY "Anyone can insert news" ON news_posts FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can view reactions" ON news_reactions FOR SELECT USING (true);
CREATE POLICY "Anyone can insert/delete reactions" ON news_reactions FOR ALL USING (true);

CREATE POLICY "Anyone can view chat" ON tournament_chat FOR SELECT USING (true);
CREATE POLICY "Anyone can insert chat" ON tournament_chat FOR INSERT WITH CHECK (true);

-- Enable Realtime
-- Remove existing publication entries
DO $$
BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE news_posts';
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE news_reactions';
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE tournament_chat';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add tables to publication
ALTER PUBLICATION supabase_realtime ADD TABLE news_posts;
ALTER PUBLICATION supabase_realtime ADD TABLE news_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE tournament_chat;
