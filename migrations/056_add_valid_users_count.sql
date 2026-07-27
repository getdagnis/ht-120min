-- Keep a small, queryable count of distinct valid Hattrick users in each tournament.
-- Existing rows start at zero; historical values can be corrected manually after cleanup.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS valid_users INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_valid_users_nonnegative;

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_valid_users_nonnegative CHECK (valid_users >= 0);

CREATE OR REPLACE FUNCTION public.refresh_tournament_valid_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_tournament_id UUID;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    affected_tournament_id := OLD.tournament_id;

    IF affected_tournament_id IS NOT NULL THEN
      UPDATE public.tournaments
      SET valid_users = (
        SELECT COUNT(DISTINCT teams.hattrick_user_id)::INTEGER
        FROM public.teams
        WHERE teams.tournament_id = affected_tournament_id
          AND teams.active IS TRUE
          AND teams.is_placeholder IS NOT TRUE
          AND teams.joined_via_oauth IS TRUE
          AND teams.hattrick_user_id IS NOT NULL
      )
      WHERE id = affected_tournament_id;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    affected_tournament_id := NEW.tournament_id;

    IF affected_tournament_id IS NOT NULL THEN
      UPDATE public.tournaments
      SET valid_users = (
        SELECT COUNT(DISTINCT teams.hattrick_user_id)::INTEGER
        FROM public.teams
        WHERE teams.tournament_id = affected_tournament_id
          AND teams.active IS TRUE
          AND teams.is_placeholder IS NOT TRUE
          AND teams.joined_via_oauth IS TRUE
          AND teams.hattrick_user_id IS NOT NULL
      )
      WHERE id = affected_tournament_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_tournament_valid_users() FROM PUBLIC;

DROP TRIGGER IF EXISTS teams_refresh_tournament_valid_users ON public.teams;

CREATE TRIGGER teams_refresh_tournament_valid_users
AFTER INSERT OR UPDATE OR DELETE ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.refresh_tournament_valid_users();

-- MIGRATION APPLIED!
