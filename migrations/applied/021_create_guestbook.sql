-- 021_create_guestbook.sql
-- Create guestbook_posts table

CREATE TABLE guestbook_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  author_name TEXT NOT NULL,
  author_ht_id BIGINT,
  author_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE guestbook_posts ENABLE ROW LEVEL SECURITY;

-- Public policies
CREATE POLICY "Anyone can view guestbook posts" ON guestbook_posts FOR SELECT USING (true);
CREATE POLICY "Anyone can insert guestbook posts" ON guestbook_posts FOR INSERT WITH CHECK (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE guestbook_posts;
