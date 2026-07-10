-- Hattrick Tournament MVP Schema

CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  admin_password TEXT NOT NULL,
  scoring_mode TEXT NOT NULL, -- '120min' or 'points'
  is_private BOOLEAN DEFAULT FALSE,
  description TEXT,
  show_description BOOLEAN DEFAULT TRUE,
  organizer_id BIGINT,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  image_url TEXT,
  include_week15_weekend_friendly BOOLEAN DEFAULT FALSE,
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
  hattrick_user_id BIGINT,
  oauth_token TEXT,
  oauth_token_secret TEXT,
  logo_url TEXT,
  country_name TEXT,
  league_level INTEGER,
  joined_via_oauth BOOLEAN DEFAULT FALSE,
  oauth_scope TEXT,
  can_manage_challenges BOOLEAN DEFAULT FALSE,
  manager_name TEXT,
  hattrick_team_id TEXT, -- Legacy
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_tournament_team UNIQUE (tournament_id, ht_team_id)
);

CREATE TABLE profiles (
  hattrick_user_id BIGINT PRIMARY KEY,
  manager_name TEXT NOT NULL,
  country_id INTEGER,
  country_name TEXT,
  avatar_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE oauth_temp_sessions (
  oauth_token TEXT PRIMARY KEY,
  oauth_token_secret TEXT NOT NULL,
  tournament_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE oauth_temp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read/Write for MVP" ON oauth_temp_sessions FOR ALL USING (true) WITH CHECK (true);

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
  venue_type TEXT DEFAULT 'home_away',
  scheduled_for TIMESTAMP WITH TIME ZONE,
  schedule_slot_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Basic RLS (Optional for MVP, but good practice)
-- For MVP, we'll keep it simple: public read, restricted write (managed via admin_password in app logic)
-- In a real app, you'd use Supabase Auth and more granular RLS.
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read" ON tournaments FOR SELECT USING (true);
CREATE POLICY "Public Read" ON teams FOR SELECT USING (true);
CREATE POLICY "Public Read" ON profiles FOR SELECT USING (true);
CREATE POLICY "Public Read" ON rounds FOR SELECT USING (true);
CREATE POLICY "Public Read" ON matches FOR SELECT USING (true);

-- For simplification in MVP, we allow all insertions/updates from the client
-- using the anon key. Security is handled by the admin_password check in the UI.
CREATE POLICY "Allow All for MVP" ON tournaments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow All for MVP" ON teams FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow All for MVP" ON profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow All for MVP" ON rounds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow All for MVP" ON matches FOR ALL USING (true) WITH CHECK (true);
