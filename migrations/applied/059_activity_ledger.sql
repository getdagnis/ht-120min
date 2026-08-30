-- Private activity ledger for Forge analytics.
-- Raw records are retained for 90 days by the server maintenance path;
-- daily counters remain available for longer-term summaries.

CREATE TABLE IF NOT EXISTS public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  visitor_id text NOT NULL,
  visit_id text,
  hattrick_user_id bigint,
  manager_name text,
  event_type text NOT NULL,
  route text,
  tournament_id uuid,
  team_id uuid,
  referrer text,
  country_code text,
  language text,
  platform text,
  browser text,
  user_agent text,
  ip_address inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS activity_events_occurred_at_idx
  ON public.activity_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_user_idx
  ON public.activity_events (hattrick_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_visitor_idx
  ON public.activity_events (visitor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_tournament_idx
  ON public.activity_events (tournament_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.activity_daily (
  activity_date date NOT NULL,
  event_type text NOT NULL,
  route text NOT NULL DEFAULT '',
  event_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (activity_date, event_type, route)
);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_daily ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.activity_events FROM anon, authenticated;
REVOKE ALL ON public.activity_daily FROM anon, authenticated;
GRANT ALL ON public.activity_events TO service_role;
GRANT ALL ON public.activity_daily TO service_role;

CREATE OR REPLACE FUNCTION public.increment_activity_daily(
  p_activity_date date,
  p_event_type text,
  p_route text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.activity_daily (activity_date, event_type, route, event_count)
  VALUES (p_activity_date, p_event_type, COALESCE(p_route, ''), 1)
  ON CONFLICT (activity_date, event_type, route)
  DO UPDATE SET event_count = public.activity_daily.event_count + 1;
$$;

REVOKE ALL ON FUNCTION public.increment_activity_daily(date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_activity_daily(date, text, text) TO service_role;

-- MIGRATION APPLIED!