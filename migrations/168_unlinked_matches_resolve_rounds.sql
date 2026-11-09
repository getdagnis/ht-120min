BEGIN;

-- Keep the existing transition implementation for pairing and membership
-- safeguards, but apply the match-link readiness rule before it runs.
ALTER FUNCTION public.apply_length_round_transition_before_organizer(uuid,integer,uuid,uuid,jsonb,uuid)
  RENAME TO apply_length_round_transition_unlinked_legacy;

REVOKE ALL ON FUNCTION public.apply_length_round_transition_unlinked_legacy(uuid,integer,uuid,uuid,jsonb,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.apply_length_round_transition_before_organizer(
  p_tournament_id uuid,
  p_season_number integer,
  p_completed_round_id uuid,
  p_next_round_id uuid,
  p_matches jsonb,
  p_champion_team_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_completed public.rounds%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  PERFORM pg_advisory_xact_lock(120,113);
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  SELECT * INTO v_completed
  FROM public.rounds
  WHERE id = p_completed_round_id
    AND tournament_id = p_tournament_id
    AND season_number = p_season_number
  FOR UPDATE;

  -- Let the existing transition return its established not-found, already-
  -- completed, and invalid-phase outcomes without making any fixture changes.
  IF NOT FOUND OR v_completed.phase_status IS DISTINCT FROM 'materialized' THEN
    RETURN public.apply_length_round_transition_unlinked_legacy(
      p_tournament_id, p_season_number, p_completed_round_id,
      p_next_round_id, p_matches, p_champion_team_id
    );
  END IF;

  PERFORM 1 FROM public.matches WHERE round_id = v_completed.id FOR UPDATE;

  -- A linked Hattrick match must have a finished result. Its schedule
  -- resolution flag cannot make an unfinished linked match ready.
  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE round_id = v_completed.id
      AND ht_match_id IS NOT NULL
      AND COALESCE(completed, false) = false
      AND status IS DISTINCT FROM 'finished'
  ) THEN
    RETURN jsonb_build_object('advanced', false, 'reason', 'round_unresolved');
  END IF;

  -- Once an unlinked fixture's scheduled slot has passed, finalize it as a
  -- DNP. Keep future unlinked fixtures pending so refreshes cannot skip rounds.
  UPDATE public.matches
  SET schedule_resolution = 'finalized_unplayed',
      status = 'misarranged'
  WHERE round_id = v_completed.id
    AND home_team_id IS NOT NULL
    AND away_team_id IS NOT NULL
    AND ht_match_id IS NULL
    AND COALESCE(completed, false) = false
    AND status IS DISTINCT FROM 'finished'
    AND scheduled_for IS NOT NULL
    AND scheduled_for <= v_now
    AND schedule_resolution IS DISTINCT FROM 'finalized_unplayed';

  UPDATE public.matches
  SET status = 'misarranged'
  WHERE round_id = v_completed.id
    AND ht_match_id IS NULL
    AND COALESCE(completed, false) = false
    AND status = 'ongoing'
    AND scheduled_for IS NOT NULL
    AND scheduled_for <= v_now;

  -- A completed result is authoritative even if a stale live status remains.
  UPDATE public.matches
  SET status = 'finished'
  WHERE round_id = v_completed.id
    AND completed = true
    AND status = 'ongoing';

  RETURN public.apply_length_round_transition_unlinked_legacy(
    p_tournament_id, p_season_number, p_completed_round_id,
    p_next_round_id, p_matches, p_champion_team_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_length_round_transition_before_organizer(uuid,integer,uuid,uuid,jsonb,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_length_round_transition_before_organizer(uuid,integer,uuid,uuid,jsonb,uuid)
  TO service_role;

COMMIT;
