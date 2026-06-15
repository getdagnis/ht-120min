-- Add teams_json to profiles to store verified teams
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS teams_json JSONB;

-- Create matchmaker_requests table (Refined)
CREATE TABLE IF NOT EXISTS matchmaker_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  manager_ht_id BIGINT NOT NULL REFERENCES profiles(hattrick_user_id),
  match_type TEXT DEFAULT '120min', -- '120min', '90min_acceptable'
  opponent_location TEXT DEFAULT 'any', -- 'domestic', 'international', 'any'
  home_away TEXT DEFAULT 'any', -- 'home', 'away', 'any'
  match_day TEXT DEFAULT 'Wednesday',
  time_window TEXT,
  message TEXT,
  status TEXT DEFAULT 'open', -- 'open', 'matched', 'expired', 'cancelled'
  matched_with_team_id UUID REFERENCES teams(id),
  matched_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create matchmaker_views table to track Skips and Matches
CREATE TABLE IF NOT EXISTS matchmaker_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_ht_id BIGINT NOT NULL REFERENCES profiles(hattrick_user_id),
  request_id UUID NOT NULL REFERENCES matchmaker_requests(id) ON DELETE CASCADE,
  decision TEXT NOT NULL, -- 'skipped', 'matched'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(manager_ht_id, request_id)
);

-- Enable RLS
ALTER TABLE matchmaker_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchmaker_views ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Public Read Requests" ON matchmaker_requests FOR SELECT USING (true);
CREATE POLICY "Allow All matchmaker_requests" ON matchmaker_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow All matchmaker_views" ON matchmaker_views FOR ALL USING (true) WITH CHECK (true);
