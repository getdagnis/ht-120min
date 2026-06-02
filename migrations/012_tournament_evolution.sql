ALTER TABLE tournaments ADD COLUMN league_category TEXT DEFAULT 'male';
ALTER TABLE tournaments ADD COLUMN registration_type TEXT DEFAULT 'validated';
ALTER TABLE tournaments ADD COLUMN season INTEGER DEFAULT 1;
ALTER TABLE tournaments ADD COLUMN is_test BOOLEAN DEFAULT false;
ALTER TABLE tournaments ADD COLUMN status TEXT DEFAULT 'open';

ALTER TABLE teams ADD COLUMN is_placeholder BOOLEAN DEFAULT false;
