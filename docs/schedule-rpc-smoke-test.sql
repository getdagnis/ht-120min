-- Manual Supabase SQL Editor smoke test for schedule migrations 047 -> 051.
-- Do not run this from the agent. Paste into Supabase SQL Editor after applying
-- the schedule migrations in a disposable/local database. The final ROLLBACK
-- should leave no test data behind.
--
-- Note: this still exercises the legacy `week15_weekend_friendly` slot type.
-- Migration 051 keeps that value backward-compatible while normalizing the
-- current frontend payloads around `weekend_friendly` plus the W15 include flag.

BEGIN;

-- Function and privilege smoke checks.
SELECT to_regprocedure('public.generate_tournament_schedule(uuid,text,jsonb,text,timestamptz,boolean)') AS rpc_signature;
SELECT has_function_privilege('anon', 'public.generate_tournament_schedule(uuid,text,jsonb,text,timestamptz,boolean)', 'EXECUTE') AS anon_can_execute;
SELECT has_function_privilege('public', 'public.generate_tournament_schedule(uuid,text,jsonb,text,timestamptz,boolean)', 'EXECUTE') AS public_can_execute;

-- Constraint accepts the new W15 value and remains nullable/backward-compatible.
DO $$
DECLARE
  v_tournament_id uuid := gen_random_uuid();
  v_round_id uuid := gen_random_uuid();
  v_team_a uuid := gen_random_uuid();
  v_team_b uuid := gen_random_uuid();
BEGIN
  INSERT INTO tournaments (id, name, slug, admin_password, status)
  VALUES (v_tournament_id, 'Constraint smoke', 'constraint-smoke-' || substr(v_tournament_id::text, 1, 8), 'pw', 'active');

  INSERT INTO teams (id, tournament_id, name, ht_team_id, active, is_placeholder)
  VALUES
    (v_team_a, v_tournament_id, 'A', 910001, true, false),
    (v_team_b, v_tournament_id, 'B', 910002, true, false);

  INSERT INTO rounds (id, tournament_id, round_number)
  VALUES (v_round_id, v_tournament_id, 1);

  INSERT INTO matches (round_id, home_team_id, away_team_id, venue_type, scheduled_for, schedule_slot_type)
  VALUES (v_round_id, v_team_a, v_team_b, 'home_away', now() + interval '30 days', 'week15_weekend_friendly');
END $$;

-- Build one valid future W15-midweek -> W15-weekend -> W16-midweek schedule.
DO $$
DECLARE
  v_tournament_id uuid := gen_random_uuid();
  v_team_a uuid := gen_random_uuid();
  v_team_b uuid := gen_random_uuid();
  v_team_c uuid := gen_random_uuid();
  v_team_d uuid := gen_random_uuid();
  v_placeholder uuid := gen_random_uuid();
  v_epoch date := DATE '2026-03-30';
  v_season integer := 94 + GREATEST(1, CEIL(((CURRENT_DATE - DATE '2026-03-30')::numeric + 21) / 112)::integer);
  v_w15_week_index integer;
  v_w15_midweek timestamptz;
  v_w15_weekend timestamptz;
  v_w16_midweek timestamptz;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  v_w15_week_index := ((v_season - 94) * 16) + 14;
  v_w15_midweek := ((v_epoch + (v_w15_week_index * 7) + 2)::timestamp AT TIME ZONE 'Europe/Stockholm');
  v_w15_weekend := ((v_epoch + (v_w15_week_index * 7) + 5)::timestamp AT TIME ZONE 'Europe/Stockholm');
  v_w16_midweek := ((v_epoch + ((v_w15_week_index + 1) * 7) + 2)::timestamp AT TIME ZONE 'Europe/Stockholm');

  INSERT INTO tournaments (id, name, slug, admin_password, status)
  VALUES (v_tournament_id, 'RPC smoke', 'rpc-smoke-' || substr(v_tournament_id::text, 1, 8), 'correct-password', 'open');

  INSERT INTO teams (id, tournament_id, name, ht_team_id, active, is_placeholder)
  VALUES
    (v_team_a, v_tournament_id, 'A', 920001, true, false),
    (v_team_b, v_tournament_id, 'B', 920002, true, false),
    (v_team_c, v_tournament_id, 'C', 920003, true, false),
    (v_team_d, v_tournament_id, 'D', 920004, true, false),
    (v_placeholder, v_tournament_id, 'Placeholder', 920005, true, true);

  v_payload := jsonb_build_object(
    'mode', 'single',
    'team_count', 4,
    'start_slot_id', 'smoke-w15-midweek',
    'start_slot_kind', 'midweek_friendly',
    'start_slot_date', v_w15_midweek,
    'include_week15_weekend_friendly', true,
    'rounds', jsonb_build_array(
      jsonb_build_object(
        'round_number', 1,
        'slot_id', 'smoke-w15-midweek',
        'slot_kind', 'midweek_friendly',
        'slot_date', v_w15_midweek,
        'display_date', v_w15_midweek + interval '19 hours',
        'matches', jsonb_build_array(
          jsonb_build_object('home_team_id', v_team_a, 'away_team_id', v_team_d, 'venue_type', 'home_away', 'scheduled_for', v_w15_midweek + interval '19 hours', 'schedule_slot_type', 'midweek_friendly'),
          jsonb_build_object('home_team_id', v_team_b, 'away_team_id', v_team_c, 'venue_type', 'home_away', 'scheduled_for', v_w15_midweek + interval '19 hours', 'schedule_slot_type', 'midweek_friendly')
        )
      ),
      jsonb_build_object(
        'round_number', 2,
        'slot_id', 'smoke-w15-weekend',
        'slot_kind', 'week15_weekend_friendly',
        'slot_date', v_w15_weekend,
        'display_date', v_w15_weekend + interval '10 hours',
        'matches', jsonb_build_array(
          jsonb_build_object('home_team_id', v_team_d, 'away_team_id', v_team_c, 'venue_type', 'home_away', 'scheduled_for', v_w15_weekend + interval '10 hours', 'schedule_slot_type', 'week15_weekend_friendly'),
          jsonb_build_object('home_team_id', v_team_a, 'away_team_id', v_team_b, 'venue_type', 'home_away', 'scheduled_for', v_w15_weekend + interval '10 hours', 'schedule_slot_type', 'week15_weekend_friendly')
        )
      ),
      jsonb_build_object(
        'round_number', 3,
        'slot_id', 'smoke-w16-midweek',
        'slot_kind', 'midweek_friendly',
        'slot_date', v_w16_midweek,
        'display_date', v_w16_midweek + interval '19 hours',
        'matches', jsonb_build_array(
          jsonb_build_object('home_team_id', v_team_a, 'away_team_id', v_team_c, 'venue_type', 'home_away', 'scheduled_for', v_w16_midweek + interval '19 hours', 'schedule_slot_type', 'midweek_friendly'),
          jsonb_build_object('home_team_id', v_team_d, 'away_team_id', v_team_b, 'venue_type', 'home_away', 'scheduled_for', v_w16_midweek + interval '19 hours', 'schedule_slot_type', 'midweek_friendly')
        )
      )
    )
  );

  -- Missing/wrong password must fail.
  BEGIN
    PERFORM public.generate_tournament_schedule(v_tournament_id, NULL, v_payload, 'single', v_w15_midweek, true);
    RAISE EXCEPTION 'missing password unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM public.generate_tournament_schedule(v_tournament_id, 'wrong-password', v_payload, 'single', v_w15_midweek, true);
    RAISE EXCEPTION 'wrong password unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- Malformed payload must fail.
  BEGIN
    PERFORM public.generate_tournament_schedule(v_tournament_id, 'correct-password', '{}'::jsonb, 'single', v_w15_midweek, true);
    RAISE EXCEPTION 'empty payload unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  -- Blocked cup week must fail.
  BEGIN
    PERFORM public.generate_tournament_schedule(
      v_tournament_id,
      'correct-password',
      jsonb_set(v_payload, '{rounds,0,slot_date}', to_jsonb(((v_epoch + (((v_season - 94) * 16) * 7) + 2)::timestamp AT TIME ZONE 'Europe/Stockholm')::text)),
      'single',
      v_w15_midweek,
      true
    );
    RAISE EXCEPTION 'blocked cup payload unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  -- Duplicate team in a round must fail.
  BEGIN
    PERFORM public.generate_tournament_schedule(
      v_tournament_id,
      'correct-password',
      jsonb_set(v_payload, '{rounds,0,matches,1,home_team_id}', to_jsonb(v_team_a::text)),
      'single',
      v_w15_midweek,
      true
    );
    RAISE EXCEPTION 'duplicate-team payload unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  -- Valid schedule succeeds; active placeholder is ignored by team_count=4.
  v_result := public.generate_tournament_schedule(v_tournament_id, 'correct-password', v_payload, 'single', v_w15_midweek, true);
  RAISE NOTICE 'valid result: %', v_result;

  IF (SELECT count(*) FROM rounds WHERE tournament_id = v_tournament_id) <> 3 THEN
    RAISE EXCEPTION 'unexpected round count';
  END IF;

  IF (
    SELECT count(*)
    FROM matches m
    JOIN rounds r ON r.id = m.round_id
    WHERE r.tournament_id = v_tournament_id
  ) <> 6 THEN
    RAISE EXCEPTION 'unexpected match count';
  END IF;
END $$;

ROLLBACK;
