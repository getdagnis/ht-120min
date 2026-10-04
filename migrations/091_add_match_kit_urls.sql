-- Match-specific CHPP DressURI snapshots; NULL means no kit was available from MatchDetails.
ALTER TABLE public.matches
  ADD COLUMN home_match_kit_url TEXT,
  ADD COLUMN away_match_kit_url TEXT;

COMMENT ON COLUMN public.matches.home_match_kit_url IS 'CHPP MatchDetails DressURI for the scheduled home fixture side.';
COMMENT ON COLUMN public.matches.away_match_kit_url IS 'CHPP MatchDetails DressURI for the scheduled away fixture side.';

-- applied!