ALTER TABLE oauth_temp_sessions ALTER COLUMN tournament_id DROP NOT NULL;
ALTER TABLE oauth_pending_joins ALTER COLUMN tournament_id DROP NOT NULL;
