-- Disposable/local DB verification for migration 082.
--
-- Run only after the repository migrations, including 082, have been applied
-- to a local Supabase database. The transaction is rolled back at the end, so
-- no fixture, team, tournament, or season rows remain.
--
-- Example:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f docs/season-admin-lifecycle-smoke-test.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert(condition boolean, message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION 'season admin smoke test failed: %', message;
  END IF;
END;
$$;

-- The RPCs are server-only. The local Supabase role names are checked here
-- explicitly because PUBLIC revocation alone is easy to miss in review.
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.reset_current_season_to_planning(uuid,integer)', 'EXECUTE'),
  'anon can execute reset RPC'
);
SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public.reset_current_season_to_planning(uuid,integer)', 'EXECUTE'),
  'authenticated can execute reset RPC'
);
SELECT pg_temp.assert(
  has_function_privilege('service_role', 'public.reset_current_season_to_planning(uuid,integer)', 'EXECUTE'),
  'service_role cannot execute reset RPC'
);
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.vacate_team_slot_in_current_season(uuid,integer,uuid)', 'EXECUTE'),
  'anon can execute vacate RPC'
);
SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public.vacate_team_slot_in_current_season(uuid,integer,uuid)', 'EXECUTE'),
  'authenticated can execute vacate RPC'
);
SELECT pg_temp.assert(
  has_function_privilege('service_role', 'public.vacate_team_slot_in_current_season(uuid,integer,uuid)', 'EXECUTE'),
  'service_role cannot execute vacate RPC'
);
SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public.replace_or_fill_known_team_in_current_season(uuid,integer,uuid,bigint)', 'EXECUTE'),
  'authenticated can execute replacement wrapper'
);
SELECT pg_temp.assert(
  has_function_privilege('service_role', 'public.replace_or_fill_known_team_in_current_season(uuid,integer,uuid,bigint)', 'EXECUTE'),
  'service_role cannot execute replacement wrapper'
);

DO $$
DECLARE
  v_tournament uuid;
  v_season uuid;
  v_round uuid;
  v_match uuid;
  v_slot uuid;
  v_assignment uuid;
  v_registration_closed timestamptz := now() - interval '1 hour';
  v_future timestamptz := now() + interval '7 days';
  v_past timestamptz := now() - interval '1 day';
  v_status text;
  v_count integer;
  v_team_a uuid;
  v_team_b uuid;
  v_team_c uuid;
  v_team_d uuid;
  v_slot_a uuid;
  v_slot_d uuid;
  v_round_chain uuid;
  v_completed_match uuid;
  v_future_match uuid;
  v_chain_assignment_a uuid;
  v_chain_assignment_d uuid;
BEGIN
  -- Reset: ongoing season with no fixtures; registration state is preserved.
  v_tournament := gen_random_uuid();
  INSERT INTO public.tournaments(id, slug, name, admin_password, scoring_mode, status, season, registration_closed_at)
  VALUES (v_tournament, 'smoke-reset-empty-' || substr(v_tournament::text, 1, 8), 'Reset empty', 'test', '120min', 'active', 1, v_registration_closed);
  INSERT INTO public.tournament_seasons(tournament_id, season_number, status, started_at)
  VALUES (v_tournament, 1, 'ongoing', now() - interval '1 hour')
  RETURNING id INTO v_season;
  PERFORM public.reset_current_season_to_planning(v_tournament, 1);
  SELECT status INTO v_status FROM public.tournament_seasons WHERE id = v_season;
  PERFORM pg_temp.assert(v_status = 'planned', 'empty season was not reset to planned');
  PERFORM pg_temp.assert((SELECT started_at IS NULL FROM public.tournament_seasons WHERE id = v_season), 'started_at was not cleared');
  PERFORM pg_temp.assert((SELECT registration_closed_at = v_registration_closed FROM public.tournaments WHERE id = v_tournament), 'registration state changed');
  PERFORM pg_temp.assert((SELECT status = 'active' FROM public.tournaments WHERE id = v_tournament), 'closed roster did not retain active tournament state');

  -- Reset: linked future fixture, slot assignment, and prior season all clear
  -- only the current season; the Hattrick ID is only a reference here.
  v_tournament := gen_random_uuid();
  INSERT INTO public.tournaments(id, slug, name, admin_password, scoring_mode, status, season, registration_closed_at)
  VALUES (v_tournament, 'smoke-reset-future-' || substr(v_tournament::text, 1, 8), 'Reset future', 'test', '120min', 'active', 1, v_registration_closed);
  INSERT INTO public.tournament_seasons(tournament_id, season_number, status) VALUES (v_tournament, 1, 'finished');
  INSERT INTO public.tournament_seasons(tournament_id, season_number, status, started_at)
  VALUES (v_tournament, 2, 'ongoing', now() - interval '1 hour') RETURNING id INTO v_season;
  UPDATE public.tournaments SET season = 2 WHERE id = v_tournament;
  INSERT INTO public.teams(id, tournament_id, name, ht_team_id, active, is_placeholder)
  VALUES (gen_random_uuid(), v_tournament, 'Future A', 991001, true, false)
  RETURNING id INTO v_slot;
  INSERT INTO public.rounds(id, tournament_id, season_number, round_number) VALUES (gen_random_uuid(), v_tournament, 2, 1) RETURNING id INTO v_round;
  INSERT INTO public.matches(round_id, home_team_id, venue_type, completed, status, scheduled_for, ht_match_id)
  VALUES (v_round, v_slot, 'home_away', false, 'arranged', v_future, 991001001) RETURNING id INTO v_match;
  INSERT INTO public.tournament_season_slots(id, tournament_season_id, slot_index, box_size, current_team_id)
  VALUES (gen_random_uuid(), v_season, 1, 2, v_slot) RETURNING id INTO v_slot;
  INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id, team_id, reason, team_name, ht_team_id)
  VALUES (v_slot, (SELECT home_team_id FROM public.matches WHERE id = v_match), 'schedule_backfill', 'Future A', 991001) RETURNING id INTO v_assignment;
  PERFORM public.reset_current_season_to_planning(v_tournament, 2);
  PERFORM pg_temp.assert((SELECT count(*) = 0 FROM public.matches WHERE round_id = v_round), 'current matches were not cleared');
  PERFORM pg_temp.assert((SELECT count(*) = 0 FROM public.rounds WHERE id = v_round), 'current rounds were not cleared');
  PERFORM pg_temp.assert((SELECT count(*) = 0 FROM public.tournament_season_slots WHERE tournament_season_id = v_season), 'current slots were not cleared');
  PERFORM pg_temp.assert((SELECT count(*) = 0 FROM public.tournament_season_slot_assignments WHERE id = v_assignment), 'current assignments were not cleared');
  PERFORM pg_temp.assert((SELECT status = 'finished' FROM public.tournament_seasons WHERE tournament_id = v_tournament AND season_number = 1), 'previous season changed during reset');
  PERFORM pg_temp.assert((SELECT registration_closed_at = v_registration_closed FROM public.tournaments WHERE id = v_tournament), 'future reset changed registration state');

  -- Reset: ongoing and completed evidence reject with no mutation.
  FOREACH v_status IN ARRAY ARRAY['ongoing', 'finished'] LOOP
    v_tournament := gen_random_uuid();
    INSERT INTO public.tournaments(id, slug, name, admin_password, scoring_mode, status, season)
    VALUES (v_tournament, 'smoke-reset-reject-' || substr(v_tournament::text, 1, 8), 'Reset reject', 'test', '120min', 'active', 1);
    INSERT INTO public.tournament_seasons(tournament_id, season_number, status) VALUES (v_tournament, 1, 'ongoing') RETURNING id INTO v_season;
    INSERT INTO public.rounds(tournament_id, season_number, round_number) VALUES (v_tournament, 1, 1) RETURNING id INTO v_round;
    INSERT INTO public.matches(round_id, venue_type, completed, status, scheduled_for)
    VALUES (v_round, 'home_away', v_status = 'finished', v_status, v_future) RETURNING id INTO v_match;
    BEGIN
      PERFORM public.reset_current_season_to_planning(v_tournament, 1);
      RAISE EXCEPTION 'expected reset rejection for % match', v_status;
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    PERFORM pg_temp.assert((SELECT status = 'ongoing' FROM public.tournament_seasons WHERE id = v_season), 'rejected reset changed season status');
    PERFORM pg_temp.assert((SELECT count(*) = 1 FROM public.matches WHERE id = v_match), 'rejected reset deleted fixture');
  END LOOP;

  -- A scheduled kickoff in the past is also a started-match safety failure,
  -- even when the result/status fields were never persisted.
  v_tournament := gen_random_uuid();
  INSERT INTO public.tournaments(id, slug, name, admin_password, scoring_mode, status, season)
  VALUES (v_tournament, 'smoke-reset-past-' || substr(v_tournament::text, 1, 8), 'Reset past', 'test', '120min', 'active', 1);
  INSERT INTO public.tournament_seasons(tournament_id, season_number, status) VALUES (v_tournament, 1, 'ongoing') RETURNING id INTO v_season;
  INSERT INTO public.rounds(tournament_id, season_number, round_number) VALUES (v_tournament, 1, 1) RETURNING id INTO v_round;
  INSERT INTO public.matches(round_id, venue_type, completed, status, scheduled_for)
  VALUES (v_round, 'home_away', false, 'arranged', v_past) RETURNING id INTO v_match;
  BEGIN
    PERFORM public.reset_current_season_to_planning(v_tournament, 1);
    RAISE EXCEPTION 'expected past-kickoff reset rejection';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  PERFORM pg_temp.assert((SELECT status = 'ongoing' FROM public.tournament_seasons WHERE id = v_season), 'past-kickoff reset changed season status');
  PERFORM pg_temp.assert((SELECT count(*) = 1 FROM public.matches WHERE id = v_match), 'past-kickoff reset deleted fixture');

  -- Removal: future unarranged fixture vacates only the side and releases the
  -- assignment; the physical slot remains available for replacement.
  v_tournament := gen_random_uuid();
  INSERT INTO public.tournaments(id, slug, name, admin_password, scoring_mode, status, season)
  VALUES (v_tournament, 'smoke-vacate-future-' || substr(v_tournament::text, 1, 8), 'Vacate future', 'test', '120min', 'active', 1);
  INSERT INTO public.tournament_seasons(tournament_id, season_number, status) VALUES (v_tournament, 1, 'ongoing') RETURNING id INTO v_season;
  INSERT INTO public.teams(id, tournament_id, name, ht_team_id, active, is_placeholder)
  VALUES (gen_random_uuid(), v_tournament, 'Vacate A', 992001, true, false) RETURNING id INTO v_slot;
  INSERT INTO public.rounds(tournament_id, season_number, round_number) VALUES (v_tournament, 1, 1) RETURNING id INTO v_round;
  INSERT INTO public.matches(round_id, home_team_id, venue_type, completed, status, scheduled_for)
  VALUES (v_round, v_slot, 'home_away', false, 'not_arranged', v_future) RETURNING id INTO v_match;
  INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
  VALUES (v_season, 1, 2, v_slot) RETURNING id INTO v_assignment;
  INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id, team_id, reason, team_name, ht_team_id)
  VALUES (v_assignment, v_slot, 'schedule_backfill', 'Vacate A', 992001) RETURNING id INTO v_round;
  UPDATE public.matches
  SET home_slot_id = v_assignment,
      home_slot_assignment_id = v_round
  WHERE id = v_match;
  PERFORM public.vacate_team_slot_in_current_season(v_tournament, 1, v_slot);
  PERFORM pg_temp.assert((SELECT current_team_id IS NULL FROM public.tournament_season_slots WHERE id = v_assignment), 'vacated slot was removed instead of emptied');
  PERFORM pg_temp.assert((SELECT released_at IS NOT NULL FROM public.tournament_season_slot_assignments WHERE id = v_round), 'assignment was deleted instead of released');
  PERFORM pg_temp.assert((SELECT active = false FROM public.teams WHERE id = v_slot), 'removed team remained active');
  PERFORM pg_temp.assert((SELECT home_team_id IS NULL FROM public.matches WHERE id = v_match), 'future fixture side was not vacated');

  -- Removal: an arranged future friendly is still unstarted, so the schedule
  -- side is vacated while the external Hattrick match reference remains.
  v_tournament := gen_random_uuid();
  INSERT INTO public.tournaments(id, slug, name, admin_password, scoring_mode, status, season)
  VALUES (v_tournament, 'smoke-vacate-arranged-' || substr(v_tournament::text, 1, 8), 'Vacate arranged', 'test', '120min', 'active', 1);
  INSERT INTO public.tournament_seasons(tournament_id, season_number, status) VALUES (v_tournament, 1, 'ongoing') RETURNING id INTO v_season;
  INSERT INTO public.teams(id, tournament_id, name, ht_team_id, active, is_placeholder)
  VALUES (gen_random_uuid(), v_tournament, 'Arranged A', 992101, true, false) RETURNING id INTO v_slot;
  INSERT INTO public.rounds(tournament_id, season_number, round_number) VALUES (v_tournament, 1, 1) RETURNING id INTO v_round;
  INSERT INTO public.matches(round_id, home_team_id, venue_type, completed, status, scheduled_for, ht_match_id)
  VALUES (v_round, v_slot, 'home_away', false, 'arranged', v_future, 992101001) RETURNING id INTO v_match;
  INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
  VALUES (v_season, 1, 2, v_slot) RETURNING id INTO v_assignment;
  INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id, team_id, reason, team_name, ht_team_id)
  VALUES (v_assignment, v_slot, 'schedule_backfill', 'Arranged A', 992101) RETURNING id INTO v_round;
  UPDATE public.matches
  SET home_slot_id = v_assignment,
      home_slot_assignment_id = v_round
  WHERE id = v_match;
  PERFORM public.vacate_team_slot_in_current_season(v_tournament, 1, v_slot);
  PERFORM pg_temp.assert((SELECT home_team_id IS NULL AND ht_match_id = 992101001 FROM public.matches WHERE id = v_match), 'future arranged fixture was not handled intentionally');

  -- Removal: ongoing fixture rejects atomically; completed identity is frozen.
  v_tournament := gen_random_uuid();
  INSERT INTO public.tournaments(id, slug, name, admin_password, scoring_mode, status, season)
  VALUES (v_tournament, 'smoke-vacate-started-' || substr(v_tournament::text, 1, 8), 'Vacate started', 'test', '120min', 'active', 1);
  INSERT INTO public.tournament_seasons(tournament_id, season_number, status) VALUES (v_tournament, 1, 'ongoing') RETURNING id INTO v_season;
  INSERT INTO public.teams(id, tournament_id, name, ht_team_id, active, is_placeholder)
  VALUES (gen_random_uuid(), v_tournament, 'Started A', 992201, true, false) RETURNING id INTO v_slot;
  INSERT INTO public.rounds(tournament_id, season_number, round_number) VALUES (v_tournament, 1, 1) RETURNING id INTO v_round;
  INSERT INTO public.matches(round_id, home_team_id, venue_type, completed, status, scheduled_for)
  VALUES (v_round, v_slot, 'home_away', false, 'ongoing', v_future) RETURNING id INTO v_match;
  INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
  VALUES (v_season, 1, 2, v_slot) RETURNING id INTO v_assignment;
  INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id, team_id, reason, team_name, ht_team_id)
  VALUES (v_assignment, v_slot, 'schedule_backfill', 'Started A', 992201);
  UPDATE public.matches
  SET home_slot_id = v_assignment
  WHERE id = v_match;
  BEGIN
    PERFORM public.vacate_team_slot_in_current_season(v_tournament, 1, v_slot);
    RAISE EXCEPTION 'expected ongoing removal rejection';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  PERFORM pg_temp.assert((SELECT active FROM public.teams WHERE id = v_slot), 'rejected ongoing removal changed team');
  PERFORM pg_temp.assert((SELECT current_team_id = v_slot FROM public.tournament_season_slots WHERE id = v_assignment), 'rejected ongoing removal changed slot');
  PERFORM pg_temp.assert((SELECT home_team_id = v_slot FROM public.matches WHERE id = v_match), 'rejected ongoing removal changed fixture');

  -- Replacement chain: A -> B -> vacant -> C. Completed history keeps A,
  -- while the current slot and future fixture side move through B and C.
  v_tournament := gen_random_uuid();
  INSERT INTO public.tournaments(id, slug, name, admin_password, scoring_mode, status, season)
  VALUES (v_tournament, 'smoke-replacement-chain-' || substr(v_tournament::text, 1, 8), 'Replacement chain', 'test', '120min', 'active', 1);
  INSERT INTO public.tournament_seasons(tournament_id, season_number, status) VALUES (v_tournament, 1, 'ongoing') RETURNING id INTO v_season;
  INSERT INTO public.teams(id, tournament_id, name, ht_team_id, active, is_placeholder)
  VALUES (gen_random_uuid(), v_tournament, 'Chain A', 992301, true, false) RETURNING id INTO v_team_a;
  INSERT INTO public.teams(id, tournament_id, name, ht_team_id, active, is_placeholder, hattrick_user_id, oauth_token, oauth_token_secret)
  VALUES (gen_random_uuid(), v_tournament, 'Chain B', 992302, false, false, 992302, 'token-b', 'secret-b') RETURNING id INTO v_team_b;
  INSERT INTO public.teams(id, tournament_id, name, ht_team_id, active, is_placeholder, hattrick_user_id, oauth_token, oauth_token_secret)
  VALUES (gen_random_uuid(), v_tournament, 'Chain C', 992303, false, false, 992303, 'token-c', 'secret-c') RETURNING id INTO v_team_c;
  INSERT INTO public.teams(id, tournament_id, name, ht_team_id, active, is_placeholder)
  VALUES (gen_random_uuid(), v_tournament, 'Chain D', 992304, true, false) RETURNING id INTO v_team_d;
  INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
  VALUES (v_season, 1, 2, v_team_a) RETURNING id INTO v_slot_a;
  INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
  VALUES ((SELECT id FROM public.tournament_seasons WHERE tournament_id = v_tournament AND season_number = 1), 2, 2, v_team_d) RETURNING id INTO v_slot_d;
  INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id, team_id, reason, team_name, ht_team_id)
  VALUES (v_slot_a, v_team_a, 'schedule_backfill', 'Chain A', 992301) RETURNING id INTO v_chain_assignment_a;
  INSERT INTO public.tournament_season_slot_assignments(tournament_season_slot_id, team_id, reason, team_name, ht_team_id)
  VALUES (v_slot_d, v_team_d, 'schedule_backfill', 'Chain D', 992304) RETURNING id INTO v_chain_assignment_d;
  INSERT INTO public.rounds(tournament_id, season_number, round_number) VALUES (v_tournament, 1, 1) RETURNING id INTO v_round_chain;
  INSERT INTO public.matches(round_id, home_team_id, away_team_id, venue_type, completed, status, scheduled_for, home_goals, away_goals)
  VALUES (v_round_chain, v_team_a, v_team_d, 'home_away', true, 'finished', v_past, 1, 0) RETURNING id INTO v_completed_match;
  INSERT INTO public.matches(round_id, home_team_id, away_team_id, venue_type, completed, status, scheduled_for)
  VALUES (v_round_chain, v_team_a, v_team_d, 'home_away', false, 'not_arranged', v_future) RETURNING id INTO v_future_match;
  UPDATE public.matches SET home_slot_id = v_slot_a, away_slot_id = v_slot_d, home_slot_assignment_id = v_chain_assignment_a, away_slot_assignment_id = v_chain_assignment_d WHERE id IN (v_completed_match, v_future_match);
  PERFORM public.replace_or_fill_known_team_in_current_season(v_tournament, 1, v_team_a, 992302);
  -- The completed row is identified by its frozen status; the future row has B.
  PERFORM pg_temp.assert((SELECT home_team_id = v_team_a FROM public.matches WHERE id = v_completed_match), 'completed history was changed during A to B');
  PERFORM pg_temp.assert((SELECT home_team_id = v_team_b FROM public.matches WHERE id = v_future_match), 'future side was not replaced by B');

  PERFORM public.vacate_team_slot_in_current_season(v_tournament, 1, v_team_b);
  PERFORM pg_temp.assert((SELECT current_team_id IS NULL FROM public.tournament_season_slots WHERE id = v_slot_a), 'B slot was not vacated');
  PERFORM pg_temp.assert((SELECT home_team_id = v_team_a FROM public.matches WHERE id = v_completed_match), 'completed A history was not frozen');
  PERFORM public.replace_or_fill_known_team_in_current_season(v_tournament, 1, v_team_b, 992303);
  PERFORM pg_temp.assert((SELECT current_team_id = v_team_c FROM public.tournament_season_slots WHERE id = v_slot_a), 'vacant slot was not filled by C');
  PERFORM pg_temp.assert((SELECT count(*) = 2 FROM public.tournament_season_slot_assignments WHERE tournament_season_slot_id = v_slot_a AND released_at IS NOT NULL), 'A/B assignment history was not retained');
  PERFORM pg_temp.assert((SELECT home_team_id = v_team_c FROM public.matches WHERE id = v_future_match), 'future side was not filled by C');

  RAISE NOTICE 'season admin lifecycle smoke tests passed';
END;
$$;

ROLLBACK;
