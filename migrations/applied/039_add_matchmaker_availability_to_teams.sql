-- Persist matchmaker availability on teams so browse cards can read from the DB
ALTER TABLE teams ADD COLUMN IF NOT EXISTS availability_status TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS availability_reason TEXT;

-- DONE!