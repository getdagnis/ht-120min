-- Read-only production preflight. Replace the values once, run as a privileged
-- operator, and attach the result to the release record before calling the RPC.
WITH target AS (
  SELECT t.id AS tournament_id, t.season AS season_number
  FROM tournaments t WHERE t.slug = 'queens-of-the-pacific-cup'
), season AS (
  SELECT s.* FROM tournament_seasons s JOIN target t ON t.tournament_id = s.tournament_id
  WHERE s.season_number = t.season_number
), fixture_sides AS (
  SELECT m.id AS match_id, r.round_number, 'home' AS side, m.completed, m.home_team_id AS team_id
  FROM matches m JOIN rounds r ON r.id = m.round_id JOIN target t ON t.tournament_id = r.tournament_id
  WHERE r.season_number = (SELECT season_number FROM target) AND m.home_team_id IS NOT NULL
  UNION ALL
  SELECT m.id, r.round_number, 'away', m.completed, m.away_team_id
  FROM matches m JOIN rounds r ON r.id = m.round_id JOIN target t ON t.tournament_id = r.tournament_id
  WHERE r.season_number = (SELECT season_number FROM target) AND m.away_team_id IS NOT NULL
)
SELECT 'team' AS check, tm.id::text AS detail, tm.name, tm.ht_team_id, tm.active, tm.hattrick_user_id,
       (tm.oauth_token IS NOT NULL AND tm.oauth_token_secret IS NOT NULL) AS has_credentials
FROM teams tm JOIN target t ON t.tournament_id = tm.tournament_id
WHERE tm.ht_team_id IN ('3220512', '3220508')
UNION ALL
SELECT 'fixture:' || fs.side, fs.match_id::text, fs.round_number::text, NULL, fs.completed, NULL, NULL
FROM fixture_sides fs JOIN teams tm ON tm.id = fs.team_id
WHERE tm.ht_team_id = '3220512';

-- Separately confirm that the incoming HT ID has no active row in an open,
-- waiting, active, or paused non-test tournament other than this one, and that
-- the output above identifies exactly one target slot/lineage before mutation.

-- Read-only post-action verifier (run only after the single approved action).
WITH target AS (
  SELECT t.id AS tournament_id, s.id AS season_id, t.season AS season_number
  FROM tournaments t JOIN tournament_seasons s ON s.tournament_id = t.id AND s.season_number = t.season
  WHERE t.slug = 'queens-of-the-pacific-cup'
), target_slot AS (
  SELECT ss.id, ss.slot_index, ss.current_team_id
  FROM tournament_season_slots ss JOIN target ON target.season_id = ss.tournament_season_id
  JOIN teams incoming ON incoming.id = ss.current_team_id
  WHERE incoming.ht_team_id = '3220508'
)
SELECT 'slot' AS check, ts.slot_index::text AS detail, incoming.name AS identity
FROM target_slot ts JOIN teams incoming ON incoming.id = ts.current_team_id
UNION ALL
SELECT CASE WHEN side.completed THEN 'completed' ELSE 'incomplete' END,
       side.match_id::text,
       CASE WHEN side.completed THEN historical.team_name ELSE live.name END
FROM (
  SELECT m.id AS match_id, m.completed, m.home_slot_id AS slot_id, m.home_team_id AS team_id, m.home_slot_assignment_id AS assignment_id
  FROM matches m JOIN rounds r ON r.id = m.round_id JOIN target ON target.tournament_id = r.tournament_id WHERE r.season_number = target.season_number
  UNION ALL
  SELECT m.id, m.completed, m.away_slot_id, m.away_team_id, m.away_slot_assignment_id
  FROM matches m JOIN rounds r ON r.id = m.round_id JOIN target ON target.tournament_id = r.tournament_id WHERE r.season_number = target.season_number
) side
LEFT JOIN tournament_season_slot_assignments historical ON historical.id = side.assignment_id
LEFT JOIN teams live ON live.id = side.team_id
WHERE side.slot_id = (SELECT id FROM target_slot);
