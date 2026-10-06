-- Homepage categories are metadata of persistent collections, not tournaments.
-- 097 is owner-marked applied and must remain unchanged.
BEGIN;
ALTER TABLE public.tournament_collections
  ADD COLUMN homepage_group text
  CHECK (homepage_group IN ('concept-120min', 'virtual-concept', 'hop-on-hop-off'));

UPDATE public.tournament_collections
SET homepage_group = 'concept-120min'
WHERE slug = 'exotic-hfi';

-- Existing Home publication must be rebuilt to include the new column.
SELECT public.mark_public_snapshot_dirty('home:directory', 1);
COMMIT;

-- applied!