ALTER TABLE public.fixture_predicted_rating_shares
  ADD COLUMN specialty_positions JSONB,
  ADD CONSTRAINT fixture_predicted_rating_shares_specialty_positions_array
    CHECK (specialty_positions IS NULL OR jsonb_typeof(specialty_positions) = 'array');

-- applied!