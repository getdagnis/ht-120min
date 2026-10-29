-- A missing row means automatic booking is off. Only the Forge server may read or write settings.
CREATE TABLE public.tournament_season_auto_booking_settings (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  season_number integer NOT NULL CHECK (season_number > 0),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, season_number)
);

ALTER TABLE public.tournament_season_auto_booking_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_season_auto_booking_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tournament_season_auto_booking_settings TO service_role;

-- applied!