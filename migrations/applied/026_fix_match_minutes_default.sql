ALTER TABLE matches ALTER COLUMN total_minutes SET DEFAULT NULL;
UPDATE matches SET total_minutes = NULL WHERE completed = false;
