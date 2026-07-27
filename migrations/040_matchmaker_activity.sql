-- Activity feed for Matchmaker ads (challenges, interest, future auto-accept, etc.)
CREATE TABLE IF NOT EXISTS matchmaker_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ad_id UUID NOT NULL REFERENCES matchmaker_requests(id) ON DELETE CASCADE,

  actor_user_id BIGINT NOT NULL,
  actor_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  actor_team_name TEXT NOT NULL,

  type TEXT NOT NULL CHECK (type IN ('challenge_sent', 'interest_shown')),
  comment TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_matchmaker_activity_ad_id_created_at
  ON matchmaker_activity (ad_id, created_at DESC);

ALTER TABLE matchmaker_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read matchmaker_activity"
  ON matchmaker_activity FOR SELECT USING (true);

CREATE POLICY "Allow insert matchmaker_activity"
  ON matchmaker_activity FOR INSERT WITH CHECK (true);

-- DONE!
