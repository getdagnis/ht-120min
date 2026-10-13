-- Restore the same Hattrick club to its released slot without discarding its
-- already-arranged friendly. Different clubs retain the original protection.
-- Patch the installed definition to preserve lifecycle locks added by 113.
BEGIN;
DO $$
DECLARE
  definition text;
  previous text;
  replacement text;
BEGIN
  definition := pg_get_functiondef('public.fill_vacant_current_season_slot_with_reserve(uuid,integer,uuid)'::regprocedure);
  previous := '  v_updated_match_count integer := 0;';
  replacement := previous || E'\n  v_restoring_same_club boolean := false;';
  IF strpos(definition, previous) = 0 THEN RAISE EXCEPTION 'Unexpected reserve fill declaration'; END IF;
  definition := replace(definition, previous, replacement);

  previous := '  ORDER BY s.slot_index';
  replacement := $patch$  ORDER BY COALESCE((
    SELECT a.ht_team_id = v_incoming.ht_team_id
    FROM public.tournament_season_slot_assignments a
    WHERE a.tournament_season_slot_id = s.id AND a.released_at IS NOT NULL
    ORDER BY a.released_at DESC, a.assigned_at DESC
    LIMIT 1
  ), false) DESC, s.slot_index$patch$;
  IF strpos(definition, previous) = 0 THEN RAISE EXCEPTION 'Unexpected vacant slot selection'; END IF;
  definition := replace(definition, previous, replacement);

  previous := '  PERFORM 1' || E'\n  FROM public.matches m';
  replacement := $patch$  SELECT COALESCE((
    SELECT a.ht_team_id = v_incoming.ht_team_id
    FROM public.tournament_season_slot_assignments a
    WHERE a.tournament_season_slot_id = v_slot.id AND a.released_at IS NOT NULL
    ORDER BY a.released_at DESC, a.assigned_at DESC
    LIMIT 1
  ), false) INTO v_restoring_same_club;

  PERFORM 1
  FROM public.matches m$patch$;
  IF strpos(definition, previous) = 0 THEN RAISE EXCEPTION 'Unexpected reserve fill fixture lock'; END IF;
  definition := replace(definition, previous, replacement);

  previous := $patch$        m.ht_match_id IS NOT NULL
        OR COALESCE(m.status, 'not_arranged') NOT IN ('not_arranged', 'misarranged')$patch$;
  replacement := $patch$        (m.ht_match_id IS NOT NULL AND NOT v_restoring_same_club)
        OR (COALESCE(m.status, 'not_arranged') NOT IN ('not_arranged', 'misarranged')
            AND NOT (v_restoring_same_club AND m.status = 'arranged'))$patch$;
  IF strpos(definition, previous) = 0 THEN RAISE EXCEPTION 'Unexpected reserve fill protection'; END IF;
  definition := replace(definition, previous, replacement);

  previous := $patch$    AND m.ht_match_id IS NULL
    AND COALESCE(m.status, 'not_arranged') IN ('not_arranged', 'misarranged')$patch$;
  replacement := $patch$    AND (m.ht_match_id IS NULL OR v_restoring_same_club)
    AND (COALESCE(m.status, 'not_arranged') IN ('not_arranged', 'misarranged')
         OR (v_restoring_same_club AND m.status = 'arranged'))$patch$;
  IF strpos(definition, previous) = 0 THEN RAISE EXCEPTION 'Unexpected reserve fill update'; END IF;
  definition := replace(definition, previous, replacement);
  EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION public.fill_vacant_current_season_slot_with_reserve(uuid,integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_vacant_current_season_slot_with_reserve(uuid,integer,uuid) TO service_role;
COMMIT;

-- applied!