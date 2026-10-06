-- Collection identity belongs to persistent tournaments, never to an edition.
BEGIN;
CREATE TABLE public.tournament_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text NOT NULL DEFAULT '',
  banner_url text,
  is_published boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0
);
CREATE TABLE public.tournament_collection_memberships (
  collection_id uuid NOT NULL REFERENCES public.tournament_collections(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  is_featured boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, tournament_id)
);
CREATE INDEX tournament_collection_memberships_tournament_idx ON public.tournament_collection_memberships (tournament_id);
ALTER TABLE public.tournament_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_collection_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_collections, public.tournament_collection_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_collections, public.tournament_collection_memberships TO anon, authenticated;
GRANT ALL ON public.tournament_collections, public.tournament_collection_memberships TO service_role;
CREATE POLICY public_collection_read ON public.tournament_collections FOR SELECT TO anon, authenticated
  USING (is_published);
CREATE POLICY public_membership_read ON public.tournament_collection_memberships FOR SELECT TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tournament_collections c WHERE c.id = collection_id AND c.is_published)
    AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id
      AND NOT t.is_private AND NOT coalesce(t.is_test, false)
      AND NOT coalesce(t.is_archived, false) AND coalesce(t.status, '') NOT IN ('stopped', 'archived'))
  );
INSERT INTO public.tournament_collections (slug, title, description, banner_url, is_published, display_order)
VALUES ('exotic-hfi', 'Exotic Small HFI Series',
  'Small Hattrick International friendly leagues from across the world. Find a country, join a league, and follow each season.',
  '/series/exotic-tiny-hfi-banner.jpg', true, 1);
-- Exact known campaign slugs; missing or test rows are deliberately skipped.
WITH targets(slug, display_order) AS (VALUES
  ('queens-of-the-pacific-cup', 1),
  ('exotic-hfi-san-marino', 2),
  ('exotic-hfi-saint-kitts-and-nevis', 3),
  ('exotic-hfi-tahiti', 4),
  ('exotic-hfi-faroe-islands', 5),
  ('exotic-hfi-gibraltar', 6),
  ('exotic-hfi-bhutan', 7),
  ('exotic-hfi-curacao', 8),
  ('exotic-hfi-barbados', 9),
  ('exotic-hfi-sao-tome-e-principe', 10),
  ('exotic-hfi-liechtenstein', 11),
  ('exotic-hfi-saint-vincent-and-the-grenadines', 12),
  ('exotic-hfi-malta', 13),
  ('exotic-hfi-andorra', 14),
  ('exotic-hfi-bahamas', 15),
  ('exotic-hfi-madagascar', 16),
  ('exotic-hfi-maldives', 17),
  ('exotic-hfi-cabo-verde', 18),
  ('exotic-hfi-suriname', 19),
  ('exotic-hfi-brunei', 20),
  ('exotic-hfi-comoros', 21),
  ('exotic-hfi-trinidad-tobago', 22)
)
INSERT INTO public.tournament_collection_memberships (collection_id, tournament_id, is_featured, display_order)
SELECT c.id, t.id, targets.display_order <= 8, targets.display_order
FROM targets
JOIN public.tournaments t ON t.slug = targets.slug
JOIN public.tournament_collections c ON c.slug = 'exotic-hfi'
WHERE NOT t.is_private AND NOT coalesce(t.is_test, false)
  AND NOT coalesce(t.is_archived, false) AND coalesce(t.status, '') NOT IN ('stopped', 'archived');
-- Reuse the existing Home publication generation and worker. Hiding a collection
-- withdraws the old origin payload before a replacement is built.
CREATE FUNCTION public.dirty_home_collection_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE close_origin boolean := false;
BEGIN
  PERFORM public.mark_public_snapshot_dirty('home:directory', 1);
  IF TG_OP = 'DELETE' THEN
    close_origin := true;
  ELSIF TG_TABLE_NAME = 'tournament_collections' AND TG_OP = 'UPDATE' THEN
    close_origin := NOT NEW.is_published;
  END IF;
  IF close_origin THEN
    UPDATE public.public_snapshots SET exposure = 'approved'
    WHERE target_key = 'home:directory' AND contract_version = 1 AND exposure = 'public';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.dirty_home_collection_source() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER home_snapshot_collections AFTER INSERT OR UPDATE OR DELETE ON public.tournament_collections
  FOR EACH ROW EXECUTE FUNCTION public.dirty_home_collection_source();
CREATE TRIGGER home_snapshot_collection_memberships AFTER INSERT OR UPDATE OR DELETE ON public.tournament_collection_memberships
  FOR EACH ROW EXECUTE FUNCTION public.dirty_home_collection_source();
-- 089 is owner-marked applied and immutable. Add the missing registration
-- boundary dependency here instead of changing that migration.
CREATE TRIGGER home_snapshot_registration_closed AFTER UPDATE OF registration_closed_at ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.dirty_home_snapshot_source('registration_closed_at');
-- Rebuild after backfill even though the new triggers were installed afterwards.
SELECT public.mark_public_snapshot_dirty('home:directory', 1);
COMMIT;


-- applied!