-- Season history for recurring tournaments.
-- Keeps the current tournament row as the live season pointer while preserving finished seasons as snapshots.

CREATE TABLE IF NOT EXISTS public.tournament_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'ongoing', 'finished')),
  planned_start_slot TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  snapshot_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, season_number)
);

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS season_number INTEGER;

UPDATE public.rounds r
SET season_number = COALESCE(t.season, 1)
FROM public.tournaments t
WHERE r.tournament_id = t.id
  AND r.season_number IS NULL;

ALTER TABLE public.rounds
  ALTER COLUMN season_number SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rounds_tournament_season
  ON public.rounds(tournament_id, season_number, round_number);

INSERT INTO public.tournament_seasons (
  tournament_id,
  season_number,
  status,
  planned_start_slot,
  started_at,
  finished_at
)
SELECT
  t.id,
  COALESCE(t.season, 1),
  CASE
    WHEN t.status = 'finished' THEN 'finished'
    WHEN EXISTS (SELECT 1 FROM public.rounds r WHERE r.tournament_id = t.id) THEN 'ongoing'
    ELSE 'planned'
  END,
  t.schedule_start_slot,
  t.schedule_generated_at,
  CASE WHEN t.status = 'finished' THEN COALESCE(t.schedule_generated_at, t.created_at) ELSE NULL END
FROM public.tournaments t
ON CONFLICT (tournament_id, season_number) DO UPDATE
SET
  planned_start_slot = COALESCE(EXCLUDED.planned_start_slot, public.tournament_seasons.planned_start_slot),
  started_at = COALESCE(EXCLUDED.started_at, public.tournament_seasons.started_at),
  finished_at = COALESCE(EXCLUDED.finished_at, public.tournament_seasons.finished_at),
  status = CASE
    WHEN public.tournament_seasons.status = 'finished' THEN 'finished'
    ELSE EXCLUDED.status
  END,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.set_round_season_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.season_number IS NULL THEN
    SELECT COALESCE(t.season, 1)
    INTO NEW.season_number
    FROM public.tournaments t
    WHERE t.id = NEW.tournament_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_round_season_number ON public.rounds;
CREATE TRIGGER trg_set_round_season_number
BEFORE INSERT ON public.rounds
FOR EACH ROW
EXECUTE FUNCTION public.set_round_season_number();

ALTER TABLE public.tournament_seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view tournament seasons"
ON public.tournament_seasons
FOR SELECT
USING (true);

CREATE POLICY "Anyone can manage tournament seasons for MVP"
ON public.tournament_seasons
FOR ALL
USING (true)
WITH CHECK (true);

-- MIGRATION APPLIED!
