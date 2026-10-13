-- Prepared only. Requires 118; does not expose predictions or credentials.
BEGIN;
ALTER TABLE public.fixture_rating_automation
  ADD COLUMN orders_given boolean,
  ADD COLUMN orders_checked_at timestamptz,
  ADD COLUMN orders_fixture_context jsonb;

CREATE FUNCTION public.record_fixture_order_status(
  p_fixture_id uuid, p_team_id uuid, p_manager_id bigint, p_ht_match_id bigint,
  p_claim_id uuid, p_orders_given boolean, p_fixture_context jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE competition_id uuid; saved boolean;
BEGIN
  SELECT tm.tournament_id INTO competition_id FROM public.teams tm WHERE tm.id=p_team_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rating-share:' || competition_id || ':' || p_team_id,0));
  UPDATE public.fixture_rating_automation a
    SET orders_given=p_orders_given,orders_checked_at=clock_timestamp(),orders_fixture_context=p_fixture_context
    FROM public.matches m, public.teams tm, public.teams opponent, public.rounds r, public.tournaments t
    WHERE a.fixture_id=p_fixture_id AND a.team_id=p_team_id AND a.ht_match_id=p_ht_match_id
      AND a.claim_id=p_claim_id AND a.claim_expires_at>clock_timestamp()
      AND m.id=a.fixture_id AND m.ht_match_id=p_ht_match_id AND m.status='arranged'
      AND NOT m.completed AND m.scheduled_for>clock_timestamp()
      AND r.id=m.round_id AND t.id=r.tournament_id AND r.season_number=t.season
      AND NOT COALESCE(t.is_archived,false) AND t.status NOT IN ('finished','archived','cancelled','stopped')
      AND tm.id=a.team_id AND tm.tournament_id=t.id AND tm.hattrick_user_id=p_manager_id
      AND tm.active AND NOT COALESCE(tm.is_placeholder,false)
      AND opponent.id=CASE WHEN m.home_team_id=tm.id THEN m.away_team_id WHEN m.away_team_id=tm.id THEN m.home_team_id END
      AND opponent.active AND NOT COALESCE(opponent.is_placeholder,false)
      AND m.home_team_id=(p_fixture_context->>'home_team_id')::uuid
      AND m.away_team_id=(p_fixture_context->>'away_team_id')::uuid
      AND tm.ht_team_id=(p_fixture_context->>CASE WHEN m.home_team_id=tm.id THEN 'home_ht_team_id' ELSE 'away_ht_team_id' END)::bigint
      AND opponent.ht_team_id=(p_fixture_context->>CASE WHEN m.home_team_id=opponent.id THEN 'home_ht_team_id' ELSE 'away_ht_team_id' END)::bigint;
  saved := FOUND;
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.record_fixture_order_status(uuid,uuid,bigint,bigint,uuid,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_fixture_order_status(uuid,uuid,bigint,bigint,uuid,boolean,jsonb) TO service_role;

-- Preserve the original first three columns. Additional fields are status only.
CREATE OR REPLACE VIEW public.fixture_predicted_rating_share_status WITH (security_barrier=true) AS
SELECT m.id AS fixture_id, tm.id AS team_id, m.ht_match_id,
  (s.id IS NOT NULL) AS shared,
  COALESCE(pref.enabled,true) AS auto_sharing_enabled,
  CASE WHEN a.orders_checked_at>now()-interval '15 minutes'
    AND a.orders_fixture_context->>'home_team_id'=m.home_team_id::text
    AND a.orders_fixture_context->>'away_team_id'=m.away_team_id::text
    AND (a.orders_fixture_context->>'home_ht_team_id')::bigint=home.ht_team_id
    AND (a.orders_fixture_context->>'away_ht_team_id')::bigint=away.ht_team_id
    THEN a.orders_given ELSE NULL END AS orders_given,
  a.orders_checked_at
FROM public.matches m
JOIN public.rounds r ON r.id=m.round_id
JOIN public.tournaments t ON t.id=r.tournament_id
JOIN public.teams home ON home.id=m.home_team_id
JOIN public.teams away ON away.id=m.away_team_id
JOIN public.teams tm ON tm.id IN (m.home_team_id,m.away_team_id)
LEFT JOIN public.fixture_predicted_rating_shares s ON s.fixture_id=m.id AND s.team_id=tm.id AND s.ht_match_id=m.ht_match_id
LEFT JOIN public.tournament_team_rating_preferences pref ON pref.tournament_id=t.id AND pref.team_id=tm.id AND pref.hattrick_user_id=tm.hattrick_user_id
LEFT JOIN public.fixture_rating_automation a ON a.fixture_id=m.id AND a.team_id=tm.id AND a.ht_match_id=m.ht_match_id
WHERE m.status='arranged' AND m.completed IS FALSE AND m.scheduled_for>now() AND m.ht_match_id>0
  AND r.season_number=t.season AND NOT COALESCE(t.is_archived,false)
  AND t.status NOT IN ('finished','archived','cancelled','stopped')
  AND home.active AND away.active AND NOT COALESCE(home.is_placeholder,false) AND NOT COALESCE(away.is_placeholder,false)
  AND home.ht_team_id>0 AND away.ht_team_id>0 AND home.ht_team_id<>away.ht_team_id;
REVOKE ALL ON public.fixture_predicted_rating_share_status FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.fixture_predicted_rating_share_status TO anon,authenticated,service_role;
COMMIT;

-- APPLIED!