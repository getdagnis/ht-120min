-- Migration: Add venue_type to matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS venue_type TEXT DEFAULT 'home_away';
