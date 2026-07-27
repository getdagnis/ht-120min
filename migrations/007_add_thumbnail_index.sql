ALTER TABLE tournaments ADD COLUMN thumbnail_index INTEGER DEFAULT floor(random() * 17 + 1)::int;
