CREATE OR REPLACE FUNCTION public.delete_owned_test_tournaments(p_organizer_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tournament_ids uuid[];
  team_ids uuid[];
  deleted_count integer;
  protected_team_count integer;
  team_reference record;
  has_reference boolean;
  has_external_reference boolean;
BEGIN
  IF p_organizer_id IS NULL THEN
    RAISE EXCEPTION 'Organizer id is required';
  END IF;

  -- Lock the full owner-scoped test set so new teams cannot join during cleanup.
  PERFORM 1
  FROM public.tournaments
  WHERE organizer_id = p_organizer_id
    AND (COALESCE(is_test, false) OR registration_type = 'sandbox')
  FOR UPDATE;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  INTO tournament_ids
  FROM public.tournaments
  WHERE organizer_id = p_organizer_id
    AND (COALESCE(is_test, false) OR registration_type = 'sandbox');

  IF cardinality(tournament_ids) = 0 THEN
    RETURN 0;
  END IF;

  -- Freeze each target roster before validating team provenance and references.
  PERFORM 1
  FROM public.teams
  WHERE tournament_id = ANY(tournament_ids)
  FOR UPDATE;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  INTO team_ids
  FROM public.teams
  WHERE tournament_id = ANY(tournament_ids);

  -- A single linked, user-owned, or Hattrick-validated team blocks the entire batch.
  SELECT count(*)
  INTO protected_team_count
  FROM public.teams
  WHERE tournament_id = ANY(tournament_ids)
    AND (
      joined_via_oauth IS TRUE
      OR hattrick_user_id IS NOT NULL
      OR NULLIF(btrim(oauth_token), '') IS NOT NULL
      OR NULLIF(btrim(oauth_token_secret), '') IS NOT NULL
      OR oauth_scope IS NOT NULL
    );

  IF protected_team_count > 0 THEN
    RAISE EXCEPTION 'Test cleanup aborted: at least one tournament contains a user-registered or Hattrick-validated team.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches m
    LEFT JOIN public.rounds owner_round ON owner_round.id = m.round_id
    WHERE (
      m.home_team_id = ANY(team_ids)
      OR m.away_team_id = ANY(team_ids)
      OR m.reserve_team_id = ANY(team_ids)
      OR m.reserve_replaces_team_id = ANY(team_ids)
    )
      AND (owner_round.tournament_id IS NULL OR NOT (owner_round.tournament_id = ANY(tournament_ids)))
  ) THEN
    RAISE EXCEPTION 'Test cleanup aborted: a test team is referenced by a match outside the selected test tournaments.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.teams other_team
    WHERE (other_team.tournament_id IS NULL OR NOT (other_team.tournament_id = ANY(tournament_ids)))
      AND (
        other_team.replacement_for_team_id = ANY(team_ids)
        OR other_team.reserve_team_id = ANY(team_ids)
        OR other_team.reserve_replaces_team_id = ANY(team_ids)
      )
  ) THEN
    RAISE EXCEPTION 'Test cleanup aborted: another tournament team record refers to a test team.'
      USING ERRCODE = '23514';
  END IF;

  -- Inspect every foreign key that points at teams.id. Tournament-scoped
  -- references are allowed only when their owning tournament is in this batch.
  -- Unknown/global references fail closed rather than being nulled or cascaded.
  FOR team_reference IN
    SELECT
      constraint_row.conrelid AS relation_id,
      constraint_row.conrelid::regclass::text AS relation_name,
      child_column.attname AS column_name
    FROM pg_catalog.pg_constraint constraint_row
    CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS child_key(attnum, ordinal)
    CROSS JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key(attnum, ordinal)
    JOIN pg_catalog.pg_attribute child_column
      ON child_column.attrelid = constraint_row.conrelid
      AND child_column.attnum = child_key.attnum
    JOIN pg_catalog.pg_attribute parent_column
      ON parent_column.attrelid = constraint_row.confrelid
      AND parent_column.attnum = parent_key.attnum
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.teams'::regclass
      AND parent_column.attname = 'id'
      AND child_column.atttypid = parent_column.atttypid
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (SELECT 1 FROM %s AS ref WHERE ref.%I = ANY($1))',
      team_reference.relation_id::regclass,
      team_reference.column_name
    ) INTO has_reference USING team_ids;

    IF NOT has_reference THEN
      CONTINUE;
    END IF;

    has_external_reference := false;

    IF team_reference.relation_id = 'public.teams'::regclass
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute
        WHERE attrelid = team_reference.relation_id
          AND attname = 'tournament_id'
          AND attnum > 0
          AND NOT attisdropped
      ) THEN
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (
           SELECT 1 FROM %s AS ref
           WHERE ref.%I = ANY($1)
             AND (ref.tournament_id IS NULL OR NOT (ref.tournament_id = ANY($2)))
         )',
        team_reference.relation_id::regclass,
        team_reference.column_name
      ) INTO has_external_reference USING team_ids, tournament_ids;
    ELSIF team_reference.relation_id = 'public.tournaments'::regclass THEN
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (
           SELECT 1 FROM %s AS ref
           WHERE ref.%I = ANY($1) AND NOT (ref.id = ANY($2))
         )',
        team_reference.relation_id::regclass,
        team_reference.column_name
      ) INTO has_external_reference USING team_ids, tournament_ids;
    ELSIF team_reference.relation_id = 'public.matches'::regclass THEN
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (
           SELECT 1 FROM %s AS ref
           LEFT JOIN public.rounds AS owner_round ON owner_round.id = ref.round_id
           WHERE ref.%I = ANY($1)
             AND (owner_round.tournament_id IS NULL OR NOT (owner_round.tournament_id = ANY($2)))
         )',
        team_reference.relation_id::regclass,
        team_reference.column_name
      ) INTO has_external_reference USING team_ids, tournament_ids;
    ELSIF team_reference.relation_id = pg_catalog.to_regclass('public.tournament_season_poll_votes') THEN
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (
           SELECT 1 FROM %s AS ref
           JOIN public.tournament_seasons AS owner_season ON owner_season.id = ref.season_id
           WHERE ref.%I = ANY($1)
             AND NOT (owner_season.tournament_id = ANY($2))
         )',
        team_reference.relation_id::regclass,
        team_reference.column_name
      ) INTO has_external_reference USING team_ids, tournament_ids;
    ELSIF team_reference.relation_id = pg_catalog.to_regclass('public.tournament_season_slots') THEN
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (
           SELECT 1 FROM %s AS ref
           JOIN public.tournament_seasons AS owner_season ON owner_season.id = ref.tournament_season_id
           WHERE ref.%I = ANY($1)
             AND NOT (owner_season.tournament_id = ANY($2))
         )',
        team_reference.relation_id::regclass,
        team_reference.column_name
      ) INTO has_external_reference USING team_ids, tournament_ids;
    ELSIF team_reference.relation_id = pg_catalog.to_regclass('public.tournament_season_slot_assignments') THEN
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (
           SELECT 1 FROM %s AS ref
           JOIN public.tournament_season_slots AS owner_slot ON owner_slot.id = ref.tournament_season_slot_id
           JOIN public.tournament_seasons AS owner_season ON owner_season.id = owner_slot.tournament_season_id
           WHERE ref.%I = ANY($1)
             AND NOT (owner_season.tournament_id = ANY($2))
         )',
        team_reference.relation_id::regclass,
        team_reference.column_name
      ) INTO has_external_reference USING team_ids, tournament_ids;
    ELSIF team_reference.relation_id = pg_catalog.to_regclass('public.fixture_predicted_rating_shares') THEN
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (
           SELECT 1 FROM %s AS ref
           JOIN public.matches AS fixture ON fixture.id = ref.fixture_id
           LEFT JOIN public.rounds AS owner_round ON owner_round.id = fixture.round_id
           WHERE ref.%I = ANY($1)
             AND (owner_round.tournament_id IS NULL OR NOT (owner_round.tournament_id = ANY($2)))
         )',
        team_reference.relation_id::regclass,
        team_reference.column_name
      ) INTO has_external_reference USING team_ids, tournament_ids;
    ELSE
      -- Any other referencing table is not proven to be owned by this batch.
      has_external_reference := true;
    END IF;

    IF has_external_reference THEN
      RAISE EXCEPTION 'Test cleanup aborted: a test team is referenced outside the selected test tournaments.'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- All safety checks are complete before the first write. Any later error rolls
  -- back this function call, so neither tournaments nor teams are partly removed.
  IF pg_catalog.to_regclass('public.tournament_season_poll_votes') IS NOT NULL THEN
    EXECUTE
      'DELETE FROM public.tournament_season_poll_votes
       WHERE season_id IN (
         SELECT id FROM public.tournament_seasons WHERE tournament_id = ANY($1)
       )'
      USING tournament_ids;
  END IF;

  DELETE FROM public.matches
  WHERE round_id IN (
    SELECT id FROM public.rounds WHERE tournament_id = ANY(tournament_ids)
  );
  DELETE FROM public.rounds WHERE tournament_id = ANY(tournament_ids);
  DELETE FROM public.teams WHERE tournament_id = ANY(tournament_ids);
  DELETE FROM public.tournaments WHERE id = ANY(tournament_ids);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_owned_test_tournaments(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_owned_test_tournaments(bigint) TO service_role;

-- applied!