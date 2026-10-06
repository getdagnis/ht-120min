-- A persistent public edit time makes the last ordering tie-break meaningful.
-- Existing rows have no historical edit timestamp, so creation time is the
-- honest backfill until their next change.
BEGIN;
ALTER TABLE public.tournaments ADD COLUMN updated_at timestamptz;
UPDATE public.tournaments SET updated_at = COALESCE(created_at, now());
ALTER TABLE public.tournaments ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.tournaments ALTER COLUMN updated_at SET NOT NULL;

CREATE FUNCTION public.touch_tournament_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Only fields already published by the 089/098 Home dependency triggers
  -- advance this public timestamp. Credential/operational edits stay private.
  IF ROW(NEW.name, NEW.slug, NEW.created_at, NEW.schedule_start_slot,
    NEW.schedule_generated_at, NEW.is_featured, NEW.is_private, NEW.is_test,
    NEW.status, NEW.is_archived, NEW.season, NEW.thumbnail_index, NEW.image_url,
    NEW.country_limit, NEW.country_limit_format, NEW.scoring_mode,
    NEW.league_category, NEW.max_teams, NEW.description, NEW.show_description)
    IS DISTINCT FROM
    ROW(OLD.name, OLD.slug, OLD.created_at, OLD.schedule_start_slot,
    OLD.schedule_generated_at, OLD.is_featured, OLD.is_private, OLD.is_test,
    OLD.status, OLD.is_archived, OLD.season, OLD.thumbnail_index, OLD.image_url,
    OLD.country_limit, OLD.country_limit_format, OLD.scoring_mode,
    OLD.league_category, OLD.max_teams, OLD.description, OLD.show_description) THEN
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_tournament_updated_at() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tournament_updated_at
BEFORE UPDATE ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION public.touch_tournament_updated_at();

SELECT public.mark_public_snapshot_dirty('home:directory', 1);
COMMIT;
