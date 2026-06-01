CREATE TABLE marketplace_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  ht_team_id BIGINT NOT NULL,
  message TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE marketplace_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read" ON marketplace_posts FOR SELECT USING (true);
CREATE POLICY "Allow All for MVP" ON marketplace_posts FOR ALL USING (true) WITH CHECK (true);
