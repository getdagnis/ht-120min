-- Keep sandbox tournaments visibly separate from real tournaments.
UPDATE public.tournaments
SET name = regexp_replace(name, '\\s+\\(test\\)$', '', 'i') || ' (test)'
WHERE registration_type = 'sandbox'
  AND name IS NOT NULL
  AND name !~* '\\s+\\(test\\)$';
