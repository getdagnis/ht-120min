-- Home only. No producer switching, CHPP scheduling, source grants or identity changes.
BEGIN;

INSERT INTO public.public_snapshots (target_key, contract_version)
VALUES ('home:directory', 1) ON CONFLICT DO NOTHING;

-- Necessary narrow privilege elevation: existing browser/SQL domain writers cannot
-- write publication tables. This trigger can dirty only this one fixed target.
CREATE FUNCTION public.dirty_home_snapshot_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_projection jsonb; new_projection jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(key, to_jsonb(OLD)->key) INTO old_projection FROM unnest(TG_ARGV) AS key;
    SELECT jsonb_object_agg(key, to_jsonb(NEW)->key) INTO new_projection FROM unnest(TG_ARGV) AS key;
    IF old_projection IS NOT DISTINCT FROM new_projection THEN RETURN NULL; END IF;
  END IF;
  PERFORM public.mark_public_snapshot_dirty('home:directory', 1);
  -- Stop admitting the previous directory at origin when listed content is
  -- removed. Retain it internally, but require a fresh successful build.
  -- The scheduler purges this approved/pending state before attempting a build.
  IF (TG_TABLE_NAME = 'tournaments' AND (
      TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (
        (to_jsonb(NEW)->>'is_private')::boolean IS TRUE OR
        (to_jsonb(NEW)->>'is_test')::boolean IS TRUE OR
        (to_jsonb(NEW)->>'is_archived')::boolean IS TRUE OR
        to_jsonb(NEW)->>'status' IN ('stopped', 'archived')))))
    OR (TG_TABLE_NAME = 'news_posts' AND TG_OP = 'DELETE') THEN
    UPDATE public.public_snapshots SET exposure = 'approved'
    WHERE target_key = 'home:directory' AND contract_version = 1 AND exposure = 'public';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.dirty_home_snapshot_source() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER home_snapshot_tournaments AFTER INSERT OR UPDATE OR DELETE ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION public.dirty_home_snapshot_source(
 'name','slug','created_at','schedule_start_slot','schedule_generated_at','is_featured','is_private','is_test','status','is_archived',
 'season','thumbnail_index','image_url','country_limit','country_limit_format','scoring_mode','league_category','max_teams');
CREATE TRIGGER home_snapshot_teams AFTER INSERT OR UPDATE OR DELETE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.dirty_home_snapshot_source(
 'tournament_id','id','name','ht_team_id','joined_via_oauth','created_at','active','reserve_active','is_placeholder',
 'manager_name','hattrick_user_id','country_id','country_name','join_story');
CREATE TRIGGER home_snapshot_rounds AFTER INSERT OR UPDATE OR DELETE ON public.rounds
FOR EACH ROW EXECUTE FUNCTION public.dirty_home_snapshot_source('tournament_id','created_at','round_number','season_number');
CREATE TRIGGER home_snapshot_matches AFTER INSERT OR UPDATE OR DELETE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.dirty_home_snapshot_source(
 'round_id','completed','status','home_team_id','away_team_id','scheduled_for','finished_at','went_120');
CREATE TRIGGER home_snapshot_warnings AFTER INSERT OR UPDATE OR DELETE ON public.fixture_warnings
FOR EACH ROW EXECUTE FUNCTION public.dirty_home_snapshot_source('round_id','team_id','active');
CREATE TRIGGER home_snapshot_news AFTER INSERT OR UPDATE OR DELETE ON public.news_posts
FOR EACH ROW EXECUTE FUNCTION public.dirty_home_snapshot_source(
 'tournament_id','season_number','round_number','created_at','is_round_report','is_admin','title','content','image_url','author_name','author_ht_user_id');

-- Atomically dirty a clean publication once its next explicit presentation boundary
-- passes. No periodic domain version, no ordinary history row, no blanket TTL.
CREATE FUNCTION public.dirty_home_snapshot_time_boundary()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.public_snapshots SET source_generation = source_generation + 1,
    due_at = clock_timestamp(), lease_token = NULL, lease_expires_at = NULL
  WHERE target_key = 'home:directory' AND contract_version = 1 AND exposure = 'public'
    AND source_generation = published_generation
    AND (payload->>'nextRefreshAt')::timestamptz <= clock_timestamp();
END;
$$;
REVOKE ALL ON FUNCTION public.dirty_home_snapshot_time_boundary() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dirty_home_snapshot_time_boundary() TO service_role;
COMMIT;
