-- Source-attributed clean rollups for long-range Forge trends.
-- The table starts at migration time; it is intentionally not backfilled from
-- activity_daily because those historical totals do not identify localhost or
-- admin traffic.

CREATE TABLE public.activity_daily_clean (
  activity_date date NOT NULL,
  event_type text NOT NULL,
  route text NOT NULL DEFAULT '',
  event_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (activity_date, event_type, route)
);

ALTER TABLE public.activity_daily_clean ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_daily_clean FROM anon, authenticated;
GRANT ALL ON public.activity_daily_clean TO service_role;

-- Keep a zero-count marker so the UI can distinguish unavailable history from
-- a date with no recorded activity.
INSERT INTO public.activity_daily_clean (activity_date, event_type, route, event_count)
VALUES ((now() AT TIME ZONE 'UTC')::date, '__clean_tracking_start__', '', 0);

CREATE OR REPLACE FUNCTION public.increment_activity_daily_clean(
  p_activity_date date,
  p_event_type text,
  p_route text
)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO public.activity_daily_clean (activity_date, event_type, route, event_count)
  VALUES (p_activity_date, p_event_type, COALESCE(p_route, ''), 1)
  ON CONFLICT (activity_date, event_type, route)
  DO UPDATE SET event_count = public.activity_daily_clean.event_count + 1;
$$;

REVOKE ALL ON FUNCTION public.increment_activity_daily_clean(date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_activity_daily_clean(date, text, text) TO service_role;

-- applied!