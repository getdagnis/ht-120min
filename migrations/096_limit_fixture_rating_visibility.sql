-- 095 is applied and immutable. Revoke its public prediction access first.
DROP POLICY IF EXISTS fixture_predicted_rating_shares_public_read
  ON public.fixture_predicted_rating_shares;
REVOKE ALL ON public.fixture_predicted_rating_shares FROM anon, authenticated, PUBLIC;

-- This deliberately narrow owner-rights view exposes only that a club shared.
-- It contains no ratings, tactic, formation, skill, fetch time, or row ID.
CREATE VIEW public.fixture_predicted_rating_share_status
  WITH (security_barrier = true)
AS
SELECT s.fixture_id, s.team_id, s.ht_match_id
FROM public.fixture_predicted_rating_shares AS s
JOIN public.matches AS m ON m.id = s.fixture_id
WHERE m.status = 'arranged'
  AND m.completed IS FALSE
  AND m.scheduled_for > NOW()
  AND m.ht_match_id = s.ht_match_id
  AND s.team_id IN (m.home_team_id, m.away_team_id);

REVOKE ALL ON public.fixture_predicted_rating_share_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fixture_predicted_rating_share_status TO anon, authenticated, service_role;

-- applied!