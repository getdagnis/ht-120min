-- Make tournament_id nullable in teams table to allow general team registration
ALTER TABLE teams ALTER COLUMN tournament_id DROP NOT NULL;

-- Partial unique index for teams not in a tournament (tournament_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS unique_general_team 
ON teams (ht_team_id) 
WHERE tournament_id IS NULL;
