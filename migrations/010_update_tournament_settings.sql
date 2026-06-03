ALTER TABLE tournaments ADD COLUMN chpp_only_join BOOLEAN DEFAULT true;
ALTER TABLE tournaments ADD COLUMN league_type TEXT DEFAULT 'male';
ALTER TABLE tournaments ADD COLUMN country_limit TEXT;
