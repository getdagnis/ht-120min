-- Structured CHPP MatchDetails event data. Numeric summary columns from 046
-- remain for existing standings/history consumers; this JSONB payload retains
-- card subtype, player/minute, injury severity, location, duration and foul data.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_event_details JSONB;

COMMENT ON COLUMN public.matches.match_event_details IS
  'Structured MatchDetails v3.1 event data, mapped to the scheduled fixture sides.';

-- MIGRATION APPLIED!