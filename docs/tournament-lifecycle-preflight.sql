-- Read-only. Run and review before applying migration 113. No credential fields.
-- 1. Exact real rosters that will become Planning (and leave discovery).
SELECT t.id,t.name,t.season,t.status,t.is_featured,t.is_private,t.registration_closed_at,
  (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id=t.id AND tm.active
    AND NOT COALESCE(tm.reserve_active,false)) AS registered_teams
FROM public.tournaments t WHERE t.status IN ('open','waiting')
  AND NOT COALESCE(t.is_test,false) AND t.registration_type IS DISTINCT FROM 'sandbox'
ORDER BY t.name;

-- 2. Must return no rows. Migration fails instead of erasing an existing schedule.
SELECT t.id,t.name,t.status,count(r.id) AS current_rounds
FROM public.tournaments t JOIN public.rounds r ON r.tournament_id=t.id
  AND COALESCE(r.season_number,1)=COALESCE(t.season,1)
WHERE t.status IN ('open','waiting') AND NOT COALESCE(t.is_test,false)
  AND t.registration_type IS DISTINCT FROM 'sandbox'
GROUP BY t.id,t.name,t.status;

-- 3. Registrations that will be withdrawn during conversion because the team
-- is already committed to a running/paused real tournament. Review by team ID.
SELECT tm.id,tm.ht_team_id,tm.name,t.name AS planning_list,other_t.name AS committed_tournament
FROM public.teams tm JOIN public.tournaments t ON t.id=tm.tournament_id
JOIN public.teams other_tm ON other_tm.ht_team_id=tm.ht_team_id AND other_tm.tournament_id<>tm.tournament_id
JOIN public.tournaments other_t ON other_t.id=other_tm.tournament_id
WHERE t.status IN ('open','waiting') AND NOT COALESCE(t.is_test,false)
  AND t.registration_type IS DISTINCT FROM 'sandbox' AND (tm.active OR tm.reapply_season_number IS NOT NULL)
  AND other_tm.active AND NOT COALESCE(other_tm.reserve_active,false)
  AND other_t.status IN ('active','paused') AND NOT COALESCE(other_t.is_test,false)
  AND other_t.registration_type IS DISTINCT FROM 'sandbox';

-- 4. There must be a per-tournament identity constraint, not a global unique
-- Hattrick-team constraint. Migration 080 already changed this; do not broaden
-- identity or slot migrations if the live schema differs.
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='teams';

-- 5. Inspect live function bodies against their repository sources. Migration
-- checks known generation/reset guard snippets and fails if they have drifted.
SELECT p.oid::regprocedure AS signature,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('reset_current_season_to_planning',
  'start_tournament_season','generate_tournament_schedule','generate_length_tournament_schedule',
  'replace_known_team_in_current_season','fill_vacant_team_slot_in_current_season',
  'swap_current_season_team_with_reserve','fill_vacant_current_season_slot_with_reserve',
  'admit_length_schedule_reserves') ORDER BY p.proname;
