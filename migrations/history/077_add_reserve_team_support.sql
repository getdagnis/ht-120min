-- Reserve teams stay in the existing tournament team model, but never become
-- active participants or consume a tournament slot.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS reserve_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reserve_joined_at TIMESTAMPTZ;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS reserve_team_id UUID REFERENCES public.teams(id),
  ADD COLUMN IF NOT EXISTS reserve_replaces_team_id UUID REFERENCES public.teams(id),
  ADD COLUMN IF NOT EXISTS reserve_story JSONB;

CREATE INDEX IF NOT EXISTS teams_tournament_reserve_active_idx
  ON public.teams (tournament_id, reserve_active)
  WHERE reserve_active = TRUE;

CREATE INDEX IF NOT EXISTS matches_reserve_team_idx
  ON public.matches (reserve_team_id)
  WHERE reserve_team_id IS NOT NULL;

-- Reserve state and reserve fixture associations are server-owned. Preserve
-- legacy browser writes, but require reserve fields to remain unchanged.
CREATE OR REPLACE FUNCTION public.team_reserve_fields_unchanged(
  p_team_id UUID,
  p_reserve_active BOOLEAN,
  p_reserve_joined_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teams
    WHERE id = p_team_id
      AND reserve_active IS NOT DISTINCT FROM p_reserve_active
      AND reserve_joined_at IS NOT DISTINCT FROM p_reserve_joined_at
      AND NOT reserve_active
  );
$$;

CREATE OR REPLACE FUNCTION public.team_can_legacy_delete(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.teams
    WHERE id = p_team_id AND reserve_active = TRUE
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.matches
    WHERE reserve_team_id = p_team_id
       OR reserve_replaces_team_id = p_team_id
       OR (reserve_team_id IS NOT NULL AND (home_team_id = p_team_id OR away_team_id = p_team_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.match_reserve_fields_unchanged(
  p_match_id UUID,
  p_home_team_id UUID,
  p_away_team_id UUID,
  p_reserve_team_id UUID,
  p_reserve_replaces_team_id UUID,
  p_reserve_story JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches
    WHERE id = p_match_id
      AND reserve_team_id IS NOT DISTINCT FROM p_reserve_team_id
      AND reserve_replaces_team_id IS NOT DISTINCT FROM p_reserve_replaces_team_id
      AND reserve_story IS NOT DISTINCT FROM p_reserve_story
      AND (
        reserve_team_id IS NULL
        OR (home_team_id IS NOT DISTINCT FROM p_home_team_id AND away_team_id IS NOT DISTINCT FROM p_away_team_id)
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.team_reserve_fields_unchanged(UUID, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_reserve_fields_unchanged(UUID, UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.team_can_legacy_delete(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_reserve_fields_unchanged(UUID, BOOLEAN, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_reserve_fields_unchanged(UUID, UUID, UUID, UUID, UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_can_legacy_delete(UUID) TO anon, authenticated;

DROP POLICY IF EXISTS "Allow All for MVP" ON public.teams;
CREATE POLICY "Allow legacy team inserts" ON public.teams
  FOR INSERT TO anon, authenticated
  WITH CHECK (reserve_active = FALSE AND reserve_joined_at IS NULL);
CREATE POLICY "Allow legacy team updates" ON public.teams
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (public.team_reserve_fields_unchanged(id, reserve_active, reserve_joined_at));
CREATE POLICY "Allow legacy team deletes" ON public.teams
  FOR DELETE TO anon, authenticated
  USING (public.team_can_legacy_delete(id));

DROP POLICY IF EXISTS "Allow All for MVP" ON public.matches;
CREATE POLICY "Allow legacy match inserts" ON public.matches
  FOR INSERT TO anon, authenticated
  WITH CHECK (reserve_team_id IS NULL AND reserve_replaces_team_id IS NULL AND reserve_story IS NULL);
CREATE POLICY "Allow legacy match updates" ON public.matches
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (public.match_reserve_fields_unchanged(id, home_team_id, away_team_id, reserve_team_id, reserve_replaces_team_id, reserve_story));
CREATE POLICY "Allow legacy match deletes" ON public.matches
  FOR DELETE TO anon, authenticated
  USING (reserve_team_id IS NULL AND reserve_replaces_team_id IS NULL AND reserve_story IS NULL);

-- applied!