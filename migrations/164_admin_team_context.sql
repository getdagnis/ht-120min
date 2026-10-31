-- Private context for explicit organizer actions. Membership remains owned by teams.
BEGIN;

CREATE TABLE public.tournament_team_admin_context (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  added_by_ht_user_id bigint,
  added_at timestamptz,
  last_moved_by_ht_user_id bigint,
  last_moved_at timestamptz,
  last_move_action text CHECK (last_move_action IN ('promote', 'to_waiting', 'remove', 'return')),
  last_move_reason text CHECK (last_move_reason IN ('admin_move', 'warnings', 'critical', 'other')),
  last_move_note text CHECK (last_move_note IS NULL OR char_length(last_move_note) <= 500)
);

CREATE TABLE public.manager_critical_removals (
  hattrick_user_id bigint PRIMARY KEY,
  severity text NOT NULL DEFAULT 'critical' CHECK (severity = 'critical'),
  reason text NOT NULL DEFAULT 'critical_removal' CHECK (reason = 'critical_removal'),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  originating_tournament_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_ht_user_id bigint NOT NULL
);

ALTER TABLE public.tournament_team_admin_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_critical_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_team_admin_context, public.manager_critical_removals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tournament_team_admin_context TO service_role;
GRANT SELECT, INSERT ON public.manager_critical_removals TO service_role;

-- The existing RPC owns all scheduling and fixture checks. This wrapper adds
-- context only after an actual state change, in the same transaction.
CREATE FUNCTION public.change_tournament_team_membership_with_context(
  p_tournament_id uuid, p_team_id uuid, p_action text, p_ready boolean,
  p_override boolean, p_actor_id bigint, p_reason text, p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  before_team public.teams%ROWTYPE;
  after_team public.teams%ROWTYPE;
  result jsonb;
  reason text := COALESCE(NULLIF(btrim(p_reason),''), 'admin_move');
  note text := NULLIF(btrim(p_note),'');
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 OR reason NOT IN ('admin_move','warnings','critical','other')
    OR char_length(COALESCE(note,'')) > 500 THEN
    RAISE EXCEPTION 'Invalid team context' USING ERRCODE='22023';
  END IF;
  IF reason IN ('warnings','critical') AND p_action <> 'remove' THEN
    RAISE EXCEPTION 'This reason requires removal to Past' USING ERRCODE='22023';
  END IF;
  IF reason = 'critical' AND (p_override IS DISTINCT FROM true OR note IS NULL) THEN
    RAISE EXCEPTION 'Critical removal requires a site-admin note' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(120,113);
  SELECT * INTO before_team FROM public.teams WHERE id=p_team_id AND tournament_id=p_tournament_id;
  result := public.change_tournament_team_membership(p_tournament_id,p_team_id,p_action,p_ready,p_override);
  SELECT * INTO after_team FROM public.teams WHERE id=p_team_id AND tournament_id=p_tournament_id;

  IF p_action IN ('promote','to_waiting','remove','return') AND
    (before_team.active IS DISTINCT FROM after_team.active OR
     before_team.reserve_active IS DISTINCT FROM after_team.reserve_active) THEN
    INSERT INTO public.tournament_team_admin_context AS c
      (team_id,tournament_id,last_moved_by_ht_user_id,last_moved_at,last_move_action,last_move_reason,last_move_note)
    VALUES (p_team_id,p_tournament_id,p_actor_id,now(),p_action,reason,note)
    ON CONFLICT (team_id) DO UPDATE SET
      last_moved_by_ht_user_id=EXCLUDED.last_moved_by_ht_user_id,
      last_moved_at=EXCLUDED.last_moved_at,
      last_move_action=EXCLUDED.last_move_action,
      last_move_reason=EXCLUDED.last_move_reason,
      last_move_note=EXCLUDED.last_move_note;
    IF reason='critical' THEN
      IF before_team.hattrick_user_id IS NULL THEN
        RAISE EXCEPTION 'Verify the manager before recording a critical removal' USING ERRCODE='22023';
      END IF;
      INSERT INTO public.manager_critical_removals
        (hattrick_user_id,note,originating_tournament_id,recorded_by_ht_user_id)
      VALUES (before_team.hattrick_user_id,note,p_tournament_id,p_actor_id)
      ON CONFLICT (hattrick_user_id) DO NOTHING;
    END IF;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.change_tournament_team_membership_with_context(uuid,uuid,text,boolean,boolean,bigint,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_tournament_team_membership_with_context(uuid,uuid,text,boolean,boolean,bigint,text,text)
  TO service_role;

-- Both admin-add variants use the existing registration checks and store origin
-- before their transaction commits. An existing Past row keeps its old origin.
CREATE FUNCTION public.save_admin_tournament_registration(
  p_values jsonb, p_existing_id uuid, p_skip_membership boolean,
  p_actor_id bigint, p_placeholder boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE saved_id uuid; old_team public.teams%ROWTYPE; new_team public.teams%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_actor_id <= 0 THEN
    RAISE EXCEPTION 'Invalid admin actor' USING ERRCODE='22023';
  END IF;
  IF p_existing_id IS NOT NULL THEN
    SELECT * INTO old_team FROM public.teams WHERE id=p_existing_id;
  END IF;
  IF p_placeholder THEN
    IF p_existing_id IS NOT NULL THEN RAISE EXCEPTION 'Placeholder already exists' USING ERRCODE='22023'; END IF;
    saved_id := public.add_tournament_team_as_site_admin(p_values);
  ELSE
    saved_id := public.save_verified_tournament_registration(p_values,p_existing_id,p_skip_membership);
  END IF;
  SELECT * INTO new_team FROM public.teams WHERE id=saved_id;
  IF p_existing_id IS NULL THEN
    INSERT INTO public.tournament_team_admin_context(team_id,tournament_id,added_by_ht_user_id,added_at)
    VALUES (saved_id,new_team.tournament_id,p_actor_id,now())
    ON CONFLICT (team_id) DO NOTHING;
  ELSIF (old_team.active IS DISTINCT FROM new_team.active OR
         old_team.reserve_active IS DISTINCT FROM new_team.reserve_active) THEN
    INSERT INTO public.tournament_team_admin_context AS c
      (team_id,tournament_id,last_moved_by_ht_user_id,last_moved_at,last_move_action,last_move_reason)
    VALUES (saved_id,new_team.tournament_id,p_actor_id,now(),'return','admin_move')
    ON CONFLICT (team_id) DO UPDATE SET
      last_moved_by_ht_user_id=EXCLUDED.last_moved_by_ht_user_id,
      last_moved_at=EXCLUDED.last_moved_at,
      last_move_action=EXCLUDED.last_move_action,
      last_move_reason=EXCLUDED.last_move_reason,
      last_move_note=NULL;
  END IF;
  RETURN saved_id;
END $$;
REVOKE ALL ON FUNCTION public.save_admin_tournament_registration(jsonb,uuid,boolean,bigint,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_tournament_registration(jsonb,uuid,boolean,bigint,boolean)
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';

-- applied!