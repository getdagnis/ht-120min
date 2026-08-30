-- Migration: Update teams table for HT ID and replacements

ALTER TABLE teams ADD COLUMN IF NOT EXISTS ht_team_id BIGINT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS ht_team_name TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS replacement_for_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
