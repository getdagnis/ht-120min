-- 089 and 097 are owner-marked applied. Extend Home's source dependencies
-- without editing either applied migration.
BEGIN;
CREATE FUNCTION public.dirty_home_tournament_description()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.description IS NOT DISTINCT FROM NEW.description
    AND OLD.show_description IS NOT DISTINCT FROM NEW.show_description THEN
    RETURN NULL;
  END IF;
  PERFORM public.mark_public_snapshot_dirty('home:directory', 1);
  -- A hidden or corrected description must leave origin admission before a
  -- replacement build; old cached copies still require the existing purge worker.
  IF OLD.show_description IS TRUE THEN
    UPDATE public.public_snapshots SET exposure = 'approved'
    WHERE target_key = 'home:directory' AND contract_version = 1 AND exposure = 'public';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.dirty_home_tournament_description() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER home_snapshot_tournament_descriptions
AFTER UPDATE OF description, show_description ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION public.dirty_home_tournament_description();

-- Existing descriptions need one fresh publication after the new builder ships.
SELECT public.mark_public_snapshot_dirty('home:directory', 1);
COMMIT;

-- applied!