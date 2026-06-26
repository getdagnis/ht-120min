-- Add oauth_scope to profiles so we can verify manage_challenges was granted
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS oauth_scope TEXT;

-- Add oauth_scope to oauth_temp_sessions so it's available during complete
ALTER TABLE oauth_temp_sessions ADD COLUMN IF NOT EXISTS oauth_scope TEXT;

-- DONE!
