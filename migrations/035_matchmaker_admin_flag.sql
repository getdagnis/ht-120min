-- Add admin flag to matchmaker_requests
ALTER TABLE matchmaker_requests ADD COLUMN IF NOT EXISTS created_by_admin BOOLEAN DEFAULT FALSE;

-- Index for tab filtering
CREATE INDEX IF NOT EXISTS idx_matchmaker_requests_gender_status ON matchmaker_requests (gender_id, status);

-- DONE!