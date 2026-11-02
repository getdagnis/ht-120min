-- Remove only future, unplayed current-season fixtures vacated on both sides.
BEGIN;

-- The existing AFTER UPDATE trigger clears 120m ratings on team-side changes.
-- Refuse to clear a side while ratings exist so that trigger cannot erase the
-- evidence before the empty-fixture cleanup checks for dependent records.
CREATE FUNCTION public.protect_rated_fixture_team_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.match_120m_ratings WHERE match_id=OLD.id) THEN
    RAISE EXCEPTION 'Fixture has stored 120m ratings; review it before removing a team'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_rated_fixture_team_removal() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER protect_rated_fixture_team_removal
BEFORE UPDATE OF home_team_id,away_team_id ON public.matches FOR EACH ROW
WHEN ((OLD.home_team_id IS NOT NULL AND NEW.home_team_id IS NULL)
   OR (OLD.away_team_id IS NOT NULL AND NEW.away_team_id IS NULL))
EXECUTE FUNCTION public.protect_rated_fixture_team_removal();

CREATE FUNCTION public.remove_empty_future_fixtures(
  p_tournament_id uuid, p_season_number integer, p_match_ids uuid[]
) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE removed_ids uuid[];
BEGIN
  IF p_tournament_id IS NULL OR p_season_number IS NULL OR p_match_ids IS NULL THEN
    RAISE EXCEPTION 'Invalid fixture cleanup request' USING ERRCODE='22023';
  END IF;
  WITH removed AS (
    DELETE FROM public.matches m USING public.rounds r, public.tournaments t
    WHERE m.id=ANY(p_match_ids) AND m.round_id=r.id
      AND r.tournament_id=p_tournament_id AND r.season_number=p_season_number
      AND r.phase='regular' AND r.phase_status='materialized'
      AND t.id=r.tournament_id AND COALESCE(t.season,1)=r.season_number
      AND t.schedule_mode='length'
      AND m.home_team_id IS NULL AND m.away_team_id IS NULL
      AND m.completed IS NOT TRUE AND m.status='not_arranged'
      AND m.schedule_resolution='pending'
      AND m.scheduled_for>now() AND m.ht_match_id IS NULL AND m.chpp_match_date IS NULL
      AND m.finished_at IS NULL AND m.home_goals IS NULL AND m.away_goals IS NULL
      AND m.match_event_details IS NULL AND m.reserve_team_id IS NULL
      AND m.reserve_replaces_team_id IS NULL AND m.reserve_story IS NULL
      AND m.actual_ht_home_team_id IS NULL AND m.actual_ht_away_team_id IS NULL
      AND m.next_match_arrange_story IS NULL AND m.match_type IS NULL
      AND m.home_match_kit_url IS NULL AND m.away_match_kit_url IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.match_120m_ratings rating WHERE rating.match_id=m.id)
      AND NOT EXISTS (SELECT 1 FROM public.fixture_predicted_rating_shares share WHERE share.fixture_id=m.id)
      AND NOT EXISTS (SELECT 1 FROM public.fixture_rating_automation automation WHERE automation.fixture_id=m.id)
      AND NOT EXISTS (SELECT 1 FROM public.forge_booking_worker_runs run WHERE run.fixture_id=m.id)
    RETURNING m.id
  ) SELECT COALESCE(array_agg(id),ARRAY[]::uuid[]) INTO removed_ids FROM removed;
  RETURN removed_ids;
END $$;
REVOKE ALL ON FUNCTION public.remove_empty_future_fixtures(uuid,integer,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.remove_empty_future_fixtures(uuid,integer,uuid[]) TO service_role;

CREATE FUNCTION public.remove_newly_emptied_future_fixture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE fixture_round record;
BEGIN
  SELECT tournament_id,season_number INTO fixture_round FROM public.rounds WHERE id=NEW.round_id;
  IF FOUND THEN
    PERFORM public.remove_empty_future_fixtures(fixture_round.tournament_id,fixture_round.season_number,ARRAY[NEW.id]);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.remove_newly_emptied_future_fixture() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER remove_newly_emptied_future_fixture
AFTER UPDATE OF home_team_id,away_team_id ON public.matches FOR EACH ROW
WHEN (NEW.home_team_id IS NULL AND NEW.away_team_id IS NULL
  AND (OLD.home_team_id IS NOT NULL OR OLD.away_team_id IS NOT NULL))
EXECUTE FUNCTION public.remove_newly_emptied_future_fixture();

COMMIT;

-- applied!