-- Tournament-scoped Lobby intent; 137's membership state remains compatible.
BEGIN;
ALTER TABLE public.teams ADD COLUMN lobby_status text NOT NULL DEFAULT 'hanging_around'
  CHECK (lobby_status IN ('hanging_around','ready_to_join','open_to_invitations'));
UPDATE public.teams SET lobby_status='ready_to_join' WHERE actively_waiting;
ALTER TABLE public.teams ADD CONSTRAINT teams_lobby_intent_consistent CHECK (
  (lobby_status='ready_to_join')=actively_waiting AND
  (lobby_status='hanging_around' OR (active IS FALSE AND reserve_active IS TRUE AND NOT COALESCE(is_placeholder,false))));

-- Synchronize legacy service RPCs while retaining one persisted intention.
-- This runs before guard_pending_team_writes: changing intent never bypasses it.
CREATE FUNCTION public.sync_team_lobby_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF ((TG_OP='INSERT' AND NEW.lobby_status<>'hanging_around') OR (TG_OP='UPDATE' AND NEW.lobby_status IS DISTINCT FROM OLD.lobby_status))
    AND current_setting('ht120.membership_write',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Lobby changes require the authorized service route' USING ERRCODE='42501';
  END IF;
  IF NEW.active IS TRUE OR NEW.reserve_active IS NOT TRUE OR COALESCE(NEW.is_placeholder,false) THEN
    NEW.lobby_status:='hanging_around'; NEW.actively_waiting:=false;
  ELSIF TG_OP='INSERT' THEN
    NEW.lobby_status:=CASE WHEN NEW.actively_waiting THEN 'ready_to_join' ELSE NEW.lobby_status END;
    NEW.actively_waiting:=NEW.lobby_status='ready_to_join';
  ELSIF NEW.lobby_status IS DISTINCT FROM OLD.lobby_status THEN
    NEW.actively_waiting:=NEW.lobby_status='ready_to_join';
  ELSIF NEW.actively_waiting IS DISTINCT FROM OLD.actively_waiting THEN
    NEW.lobby_status:=CASE WHEN NEW.actively_waiting THEN 'ready_to_join' ELSE 'hanging_around' END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_sync_team_lobby_intent BEFORE INSERT OR UPDATE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.sync_team_lobby_intent();

CREATE FUNCTION public.change_tournament_lobby_status(
  p_tournament_id uuid,p_team_id uuid,p_status text,p_manager_id bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE candidate public.teams%ROWTYPE; previous_write text:=current_setting('ht120.membership_write',true);
BEGIN
  PERFORM pg_advisory_xact_lock(120,113);
  PERFORM 1 FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  SELECT * INTO candidate FROM public.teams WHERE id=p_team_id AND tournament_id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR candidate.active IS NOT FALSE OR candidate.reserve_active IS NOT TRUE OR COALESCE(candidate.is_placeholder,false) THEN
    RAISE EXCEPTION 'Choose a Lobby team' USING ERRCODE='40001'; END IF;
  IF p_manager_id IS NOT NULL AND candidate.hattrick_user_id IS DISTINCT FROM p_manager_id THEN
    RAISE EXCEPTION 'This team belongs to another manager' USING ERRCODE='42501'; END IF;
  IF p_status NOT IN ('hanging_around','ready_to_join','open_to_invitations') OR p_status IS NULL THEN
    RAISE EXCEPTION 'Invalid Lobby status' USING ERRCODE='22023'; END IF;
  PERFORM public.change_tournament_team_membership(p_tournament_id,p_team_id,'ready',p_status='ready_to_join');
  PERFORM set_config('ht120.membership_write','true',true);
  UPDATE public.teams SET lobby_status=p_status WHERE id=p_team_id;
  PERFORM set_config('ht120.membership_write',COALESCE(previous_write,'false'),true);
  RETURN jsonb_build_object('ok',true,'teamId',p_team_id,'status',p_status);
END $$;
REVOKE ALL ON FUNCTION public.change_tournament_lobby_status(uuid,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_tournament_lobby_status(uuid,uuid,text,bigint) TO service_role;
COMMIT;
