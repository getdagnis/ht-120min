-- Pending OAuth join: team picker after Hattrick authorization

CREATE TABLE IF NOT EXISTS oauth_pending_joins (
  selection_token TEXT PRIMARY KEY,
  tournament_id UUID NOT NULL,
  access_token TEXT NOT NULL,
  access_token_secret TEXT NOT NULL,
  hattrick_user_id BIGINT,
  manager_name TEXT,
  teams_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE oauth_pending_joins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read/Write for MVP" ON oauth_pending_joins FOR ALL USING (true) WITH CHECK (true);
