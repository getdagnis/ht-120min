-- Add a partial unique index to enforce uniqueness for general teams (tournament_id IS NULL)
CREATE UNIQUE INDEX unique_general_team
ON teams(ht_team_id)
WHERE tournament_id IS NULL;
