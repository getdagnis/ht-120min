-- One-time repair for the four already-active teams that have no current-season
-- slot in the two blocked length tournaments. Review the target UUIDs and the
-- read-only preflight before applying. This does not create or alter fixtures.
BEGIN;

DO $$
DECLARE
  target record;
  member public.teams%ROWTYPE;
  season_id uuid;
  next_round_id uuid;
  actual_missing uuid[];
  slot_count integer;
  occupied_count integer;
  max_slot_index integer;
  min_box_size integer;
  max_box_size integer;
  new_box_size integer;
  new_slot_id uuid;
BEGIN
  -- Match the admission and round-transition lock so the preflight and repair
  -- cannot race with a roster change or another progression attempt.
  PERFORM pg_advisory_xact_lock(120, 113);

  FOR target IN
    SELECT * FROM (VALUES
      (
        '14d73da0-7cdc-4d17-beac-836522c55474'::uuid,
        '86527bfc-3e6e-48e8-a2a8-7f3eea9b287a'::uuid,
        ARRAY[
          '3041e61c-5684-4560-b139-20ecb18ff779'::uuid,
          '44a46a0f-f184-4d49-9d38-1058467c6b3d'::uuid,
          '5105752d-6d6b-4975-afce-1c868593fb91'::uuid
        ]::uuid[],
        155,
        152,
        160
      ),
      (
        'd75986b0-139e-42dc-a4c0-317dcf2fd7ff'::uuid,
        '5b85c09e-8c77-46a9-9648-6f3e445c069e'::uuid,
        ARRAY['a47435f2-2455-4351-89b0-1ba0c3727397'::uuid]::uuid[],
        11,
        10,
        12
      )
    ) AS targets(tournament_id, current_round_id, expected_missing, expected_active, expected_occupied, expected_box)
  LOOP
    PERFORM 1 FROM public.tournaments t
    WHERE t.id = target.tournament_id AND t.status = 'active'
      AND t.schedule_mode = 'length' AND COALESCE(t.season, 1) = 1
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target tournament state changed: %', target.tournament_id; END IF;

    SELECT s.id INTO season_id FROM public.tournament_seasons s
    WHERE s.tournament_id = target.tournament_id AND s.season_number = 1
    FOR UPDATE;
    IF season_id IS NULL THEN RAISE EXCEPTION 'Target season is missing: %', target.tournament_id; END IF;

    PERFORM 1 FROM public.rounds r
    WHERE r.id = target.current_round_id AND r.tournament_id = target.tournament_id
      AND r.season_number = 1 AND r.phase_status = 'materialized'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current round changed: %', target.tournament_id; END IF;
    SELECT r_next.id INTO next_round_id FROM public.rounds r_next
    JOIN public.rounds current_round ON current_round.id = target.current_round_id
    WHERE r_next.tournament_id = target.tournament_id AND r_next.season_number = 1
      AND r_next.round_number = current_round.round_number + 1 AND r_next.phase_status = 'pending'
      AND r_next.phase = 'regular'
    FOR UPDATE OF r_next;
    IF next_round_id IS NULL THEN RAISE EXCEPTION 'Next round changed: %', target.tournament_id; END IF;
    IF EXISTS (SELECT 1 FROM public.matches WHERE round_id = next_round_id) THEN
      RAISE EXCEPTION 'Pending round already has fixtures: %', target.tournament_id;
    END IF;

    PERFORM 1 FROM public.tournament_season_slots
    WHERE tournament_season_id = season_id FOR UPDATE;
    SELECT count(*), count(*) FILTER (WHERE current_team_id IS NOT NULL),
      max(slot_index), min(box_size), max(box_size)
    INTO slot_count, occupied_count, max_slot_index, min_box_size, max_box_size
    FROM public.tournament_season_slots WHERE tournament_season_id = season_id;
    IF slot_count <> target.expected_box OR occupied_count <> target.expected_occupied
      OR max_slot_index <> target.expected_box OR min_box_size <> target.expected_box
      OR max_box_size <> target.expected_box OR mod(max_slot_index, 2) <> 0 THEN
      RAISE EXCEPTION 'Season slot box changed: %', target.tournament_id;
    END IF;

    PERFORM 1 FROM public.teams WHERE tournament_id = target.tournament_id FOR UPDATE;
    SELECT COALESCE(array_agg(t.id ORDER BY t.id), '{}'::uuid[]) INTO actual_missing
    FROM public.teams t
    LEFT JOIN public.tournament_season_slots s
      ON s.tournament_season_id = season_id AND s.current_team_id = t.id
    WHERE t.tournament_id = target.tournament_id AND t.active IS TRUE
      AND t.reserve_active IS NOT TRUE AND NOT COALESCE(t.is_placeholder, false)
      AND s.id IS NULL;
    IF actual_missing IS DISTINCT FROM target.expected_missing
      OR (SELECT count(*) FROM public.teams t WHERE t.tournament_id = target.tournament_id
        AND t.active IS TRUE AND t.reserve_active IS NOT TRUE AND NOT COALESCE(t.is_placeholder, false))
        <> target.expected_active THEN
      RAISE EXCEPTION 'Active roster changed: %', target.tournament_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.tournament_season_slot_assignments a
      JOIN public.tournament_season_slots s ON s.id = a.tournament_season_slot_id
      WHERE s.tournament_season_id = season_id AND a.team_id = ANY(target.expected_missing)
        AND a.released_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
      WHERE r.tournament_id = target.tournament_id AND r.season_number = 1
        AND (m.home_team_id = ANY(target.expected_missing)
          OR m.away_team_id = ANY(target.expected_missing)
          OR m.reserve_team_id = ANY(target.expected_missing))
    ) THEN
      RAISE EXCEPTION 'A target team already has a current assignment or fixture: %', target.tournament_id;
    END IF;

    new_box_size := max_slot_index + 2 * cardinality(target.expected_missing);
    UPDATE public.tournament_season_slots SET box_size = new_box_size
    WHERE tournament_season_id = season_id;
    FOR member IN SELECT * FROM public.teams
      WHERE id = ANY(target.expected_missing) ORDER BY id
    LOOP
      max_slot_index := max_slot_index + 1;
      INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size, current_team_id)
      VALUES (season_id, max_slot_index, new_box_size, member.id) RETURNING id INTO new_slot_id;
      INSERT INTO public.tournament_season_slot_assignments(
        tournament_season_slot_id, team_id, reason, team_name, ht_team_id,
        manager_name, hattrick_user_id, logo_url, admission_request_id,
        entry_round_id, ranking_source, ranking_value
      )
      VALUES (new_slot_id, member.id, 'reserve_admission', member.name, member.ht_team_id,
        member.manager_name, member.hattrick_user_id, member.logo_url, gen_random_uuid(),
        next_round_id, 'power_rating', member.power_rating);
      max_slot_index := max_slot_index + 1;
      INSERT INTO public.tournament_season_slots(tournament_season_id, slot_index, box_size)
      VALUES (season_id, max_slot_index, new_box_size);
    END LOOP;
  END LOOP;
END;
$$;

COMMIT;

-- applied!