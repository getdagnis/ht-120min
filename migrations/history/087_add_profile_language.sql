ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language_id INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language_name TEXT;

--applied!