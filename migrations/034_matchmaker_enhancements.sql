-- Fix typo: leage_id -> league_id
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teams' AND column_name = 'leage_id') THEN
        ALTER TABLE teams RENAME COLUMN leage_id TO league_id;
    END IF;
END $$;

-- Add new columns to teams
ALTER TABLE teams ADD COLUMN IF NOT EXISTS gender_id INTEGER DEFAULT 1; -- 1 = Men, 2 = Women
ALTER TABLE teams ADD COLUMN IF NOT EXISTS fanclub_size INTEGER;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS arena_id BIGINT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS arena_size INTEGER;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS arena_image_url TEXT;

-- Add new columns to matchmaker_requests
ALTER TABLE matchmaker_requests ADD COLUMN IF NOT EXISTS is_back_and_forth BOOLEAN DEFAULT FALSE;
ALTER TABLE matchmaker_requests ADD COLUMN IF NOT EXISTS is_long_term BOOLEAN DEFAULT FALSE;
ALTER TABLE matchmaker_requests ADD COLUMN IF NOT EXISTS gender_id INTEGER DEFAULT 1; -- Denormalized for easier filtering

-- Add league_id to profiles for flags
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS league_id INTEGER;
