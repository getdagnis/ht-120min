-- Persist manager CHPP credentials for fresh Matchmaker syncs
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS oauth_token TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS oauth_token_secret TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS chpp_synced_at TIMESTAMPTZ;

-- Keep team metadata aligned with the current CHPP roster
ALTER TABLE teams ADD COLUMN IF NOT EXISTS league_id BIGINT;
