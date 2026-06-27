ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS penalty_shootout_home_goals INTEGER,
  ADD COLUMN IF NOT EXISTS penalty_shootout_away_goals INTEGER;
