-- Existing tournaments may already contain names that normalize to the same value.
-- Preserve those display names, but reject new duplicates and future edits.
DROP INDEX IF EXISTS public.tournaments_name_normalized_unique;

CREATE OR REPLACE FUNCTION public.enforce_tournament_name_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_name text;
BEGIN
  normalized_name := lower(regexp_replace(COALESCE(NEW.name, ''), '[^[:alnum:]]', '', 'g'));

  IF normalized_name <> '' AND EXISTS (
    SELECT 1
    FROM public.tournaments existing
    WHERE existing.id IS DISTINCT FROM NEW.id
      AND lower(regexp_replace(COALESCE(existing.name, ''), '[^[:alnum:]]', '', 'g')) = normalized_name
  ) THEN
    RAISE EXCEPTION 'A tournament with this name already exists.'
      USING ERRCODE = '23505',
            CONSTRAINT = 'tournaments_name_normalized_unique';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournaments_name_normalized_unique ON public.tournaments;
CREATE TRIGGER tournaments_name_normalized_unique
BEFORE INSERT OR UPDATE OF name ON public.tournaments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tournament_name_uniqueness();


-- MIGRATION APPLIED!
