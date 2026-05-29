-- Migration: Update teams table for CHPP OAuth integration

ALTER TABLE teams ADD COLUMN IF NOT EXISTS hattrick_user_id BIGINT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS oauth_token TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS oauth_token_secret TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS country_name TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS joined_via_oauth BOOLEAN DEFAULT FALSE;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS oauth_scope TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS can_manage_challenges BOOLEAN DEFAULT FALSE;

-- Add unique constraint for (tournament_id, hattrick_team_id)
-- Note: we use ht_team_id which was already there from previous step
ALTER TABLE teams DROP CONSTRAINT IF EXISTS unique_tournament_team;
ALTER TABLE teams ADD CONSTRAINT unique_tournament_team UNIQUE (tournament_id, ht_team_id);

-- Create table for temporary OAuth sessions
CREATE TABLE IF NOT EXISTS oauth_temp_sessions (
  oauth_token TEXT PRIMARY KEY,
  oauth_token_secret TEXT NOT NULL,
  tournament_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on temp sessions
ALTER TABLE oauth_temp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read/Write for MVP" ON oauth_temp_sessions FOR ALL USING (true) WITH CHECK (true);
