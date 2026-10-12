-- Optional entry theme; NULL preserves the visitor's site preference.
ALTER TABLE public.tournaments
  ADD COLUMN default_theme text
  CHECK (default_theme IN ('light', 'dark'));

-- applied!