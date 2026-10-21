-- Run read-only before 137. Compare these IDs/counts with the current admin lists.
-- There are no UPDATE/DELETE statements in this preview.
SELECT tournament_id,id,name,ht_team_id,active,reserve_active,pending_entry_round_id,
  CASE WHEN active IS TRUE AND reserve_active IS NOT TRUE THEN 'Active'
    WHEN reserve_active IS TRUE OR pending_entry_round_id IS NOT NULL THEN 'Waiting'
    ELSE 'Past' END AS list_after_137,
  false AS actively_waiting_after_137
FROM public.teams WHERE NOT COALESCE(is_placeholder,false)
ORDER BY tournament_id,name,id;
SELECT tournament_id,count(*) FILTER (WHERE reserve_active IS TRUE AND NOT COALESCE(is_placeholder,false)) AS current_reserve_list,
  count(*) FILTER (WHERE pending_entry_round_id IS NOT NULL AND NOT COALESCE(is_placeholder,false)) AS current_pending,
  count(*) FILTER (WHERE active IS TRUE AND (reserve_active IS TRUE OR pending_entry_round_id IS NOT NULL)) AS contradictory_membership
FROM public.teams GROUP BY tournament_id ORDER BY tournament_id;
SELECT proname,pg_get_function_identity_arguments(oid) FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname IN
 ('request_next_round_tournament_join','apply_length_round_transition_with_joins','save_verified_tournament_registration','remove_unused_past_tournament_team');

-- Must match the six-argument 107 transition contract and behavior used by 137.
SELECT pg_get_functiondef('public.apply_length_round_transition(uuid,integer,uuid,uuid,jsonb,uuid)'::regprocedure);
-- Duplicate tournament identities require review before normalizing membership.
SELECT tournament_id,ht_team_id,count(*) FROM public.teams
WHERE ht_team_id IS NOT NULL GROUP BY tournament_id,ht_team_id HAVING count(*)>1;
-- Review legacy occupancy mismatches before progressing a generated length season.
SELECT t.id AS tournament_id,tm.id AS team_id,tm.active,tm.reserve_active,
  count(sl.id) AS occupied_current_slots
FROM public.tournaments t
JOIN public.teams tm ON tm.tournament_id=t.id AND NOT COALESCE(tm.is_placeholder,false)
LEFT JOIN public.tournament_seasons se ON se.tournament_id=t.id AND se.season_number=COALESCE(t.season,1)
LEFT JOIN public.tournament_season_slots sl ON sl.tournament_season_id=se.id AND sl.current_team_id=tm.id
WHERE t.schedule_mode='length' AND t.schedule_generated_at IS NOT NULL
GROUP BY t.id,tm.id,tm.active,tm.reserve_active
HAVING (tm.active IS TRUE AND tm.reserve_active IS NOT TRUE AND count(sl.id)<>1)
  OR ((tm.active IS NOT TRUE OR tm.reserve_active IS TRUE) AND count(sl.id)>0);
