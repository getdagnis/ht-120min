-- Hattrick Tournament MVP Schema

CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  admin_password TEXT NOT NULL,
  scoring_mode TEXT NOT NULL, -- '120m' or 'points'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ht_team_id BIGINT,
  ht_team_name TEXT,
  active BOOLEAN DEFAULT TRUE,
  replacement_for_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  manager_name TEXT,
  hattrick_team_id TEXT, -- Keep for backwards compat if needed, though we use ht_team_id now
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID REFERENCES rounds(id) ON DELETE CASCADE,
  home_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  away_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  home_goals INTEGER,
  away_goals INTEGER,
  went_120 BOOLEAN DEFAULT FALSE,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Basic RLS (Optional for MVP, but good practice)
-- For MVP, we'll keep it simple: public read, restricted write (managed via admin_password in app logic)
-- In a real app, you'd use Supabase Auth and more granular RLS.
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read" ON tournaments FOR SELECT USING (true);
CREATE POLICY "Public Read" ON teams FOR SELECT USING (true);
CREATE POLICY "Public Read" ON rounds FOR SELECT USING (true);
CREATE POLICY "Public Read" ON matches FOR SELECT USING (true);

-- For simplification in MVP, we allow all insertions/updates from the client
-- using the anon key. Security is handled by the admin_password check in the UI.
CREATE POLICY "Allow All for MVP" ON tournaments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow All for MVP" ON teams FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow All for MVP" ON rounds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow All for MVP" ON matches FOR ALL USING (true) WITH CHECK (true);
