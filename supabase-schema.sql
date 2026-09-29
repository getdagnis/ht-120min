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
  team_rank INTEGER,
  joined_via_oauth BOOLEAN DEFAULT FALSE,
  oauth_scope TEXT,
  can_manage_challenges BOOLEAN DEFAULT FALSE,
  manager_name TEXT,
  join_story JSONB,
  reserve_active BOOLEAN NOT NULL DEFAULT FALSE,
  reserve_joined_at TIMESTAMP WITH TIME ZONE,
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

CREATE TABLE global_chat (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name TEXT NOT NULL,
  author_ht_id BIGINT NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
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
  finished_at TIMESTAMP WITH TIME ZONE,
  reserve_team_id UUID REFERENCES teams(id),
  reserve_replaces_team_id UUID REFERENCES teams(id),
  venue_type TEXT DEFAULT 'home_away',
  scheduled_for TIMESTAMP WITH TIME ZONE,
  schedule_slot_type TEXT,
  next_match_arrange_story JSONB,
  reserve_story JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Basic RLS (Optional for MVP, but good practice)
-- For MVP, we'll keep it simple: public read, restricted write (managed via admin_password in app logic)
-- In a real app, you'd use Supabase Auth and more granular RLS.
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION team_reserve_fields_unchanged(
  p_team_id UUID,
  p_reserve_active BOOLEAN,
  p_reserve_joined_at TIMESTAMP WITH TIME ZONE
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teams
    WHERE id = p_team_id
      AND reserve_active IS NOT DISTINCT FROM p_reserve_active
      AND reserve_joined_at IS NOT DISTINCT FROM p_reserve_joined_at
      AND NOT reserve_active
  );
$$;

CREATE OR REPLACE FUNCTION team_can_legacy_delete(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM teams
    WHERE id = p_team_id AND reserve_active = TRUE
  )
  AND NOT EXISTS (
    SELECT 1 FROM matches
    WHERE reserve_team_id = p_team_id
       OR reserve_replaces_team_id = p_team_id
       OR (reserve_team_id IS NOT NULL AND (home_team_id = p_team_id OR away_team_id = p_team_id))
  );
$$;

CREATE OR REPLACE FUNCTION match_reserve_fields_unchanged(
  p_match_id UUID,
  p_home_team_id UUID,
  p_away_team_id UUID,
  p_reserve_team_id UUID,
  p_reserve_replaces_team_id UUID,
  p_reserve_story JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM matches
    WHERE id = p_match_id
      AND reserve_team_id IS NOT DISTINCT FROM p_reserve_team_id
      AND reserve_replaces_team_id IS NOT DISTINCT FROM p_reserve_replaces_team_id
      AND reserve_story IS NOT DISTINCT FROM p_reserve_story
      AND (
        reserve_team_id IS NULL
        OR (home_team_id IS NOT DISTINCT FROM p_home_team_id AND away_team_id IS NOT DISTINCT FROM p_away_team_id)
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION team_reserve_fields_unchanged(UUID, BOOLEAN, TIMESTAMP WITH TIME ZONE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION match_reserve_fields_unchanged(UUID, UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION team_can_legacy_delete(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION team_reserve_fields_unchanged(UUID, BOOLEAN, TIMESTAMP WITH TIME ZONE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION match_reserve_fields_unchanged(UUID, UUID, UUID, UUID, UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION team_can_legacy_delete(UUID) TO anon, authenticated;

CREATE POLICY "Public Read" ON tournaments FOR SELECT USING (true);
CREATE POLICY "Public Read" ON teams FOR SELECT USING (true);
CREATE POLICY "Public Read" ON profiles FOR SELECT USING (true);
CREATE POLICY "Public Read" ON global_chat FOR SELECT USING (true);
CREATE POLICY "Public Read" ON rounds FOR SELECT USING (true);
CREATE POLICY "Public Read" ON matches FOR SELECT USING (true);

-- Legacy browser writes remain available for existing MVP fields. Reserve
-- fields are kept unchanged by browser roles; server routes use service_role.
CREATE POLICY "Allow All for MVP" ON tournaments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow legacy team inserts" ON teams FOR INSERT TO anon, authenticated
  WITH CHECK (reserve_active = FALSE AND reserve_joined_at IS NULL);
CREATE POLICY "Allow legacy team updates" ON teams FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (team_reserve_fields_unchanged(id, reserve_active, reserve_joined_at));
CREATE POLICY "Allow legacy team deletes" ON teams FOR DELETE TO anon, authenticated USING (team_can_legacy_delete(id));
CREATE POLICY "Allow All for MVP" ON profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow All for MVP" ON rounds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow legacy match inserts" ON matches FOR INSERT TO anon, authenticated
  WITH CHECK (reserve_team_id IS NULL AND reserve_replaces_team_id IS NULL AND reserve_story IS NULL);
CREATE POLICY "Allow legacy match updates" ON matches FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (match_reserve_fields_unchanged(id, home_team_id, away_team_id, reserve_team_id, reserve_replaces_team_id, reserve_story));
CREATE POLICY "Allow legacy match deletes" ON matches FOR DELETE TO anon, authenticated
  USING (reserve_team_id IS NULL AND reserve_replaces_team_id IS NULL AND reserve_story IS NULL);
