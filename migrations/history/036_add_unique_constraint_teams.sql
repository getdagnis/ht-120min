-- Add unique constraint to allow upsert
ALTER TABLE teams ADD CONSTRAINT teams_ht_team_id_key UNIQUE (ht_team_id);

-- DONE!