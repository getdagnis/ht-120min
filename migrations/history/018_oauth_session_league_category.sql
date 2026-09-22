-- Persist tournament category during creation OAuth (no tournament row yet)
ALTER TABLE oauth_temp_sessions ADD COLUMN IF NOT EXISTS league_category TEXT DEFAULT 'male';
ALTER TABLE oauth_temp_sessions ADD COLUMN IF NOT EXISTS country_limit TEXT;
