-- Add venue mismatch tracking columns to matches
-- When teams play the correct opponents but swap home/away,
-- we record the actual HT venue while preserving the scheduled fixture order.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS venue_mismatch BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS actual_ht_home_team_id BIGINT,
  ADD COLUMN IF NOT EXISTS actual_ht_away_team_id BIGINT;

-- DONE!