-- Add canonical country id to teams for CHPP-derived metadata
ALTER TABLE teams ADD COLUMN IF NOT EXISTS country_id BIGINT;

-- DONE!