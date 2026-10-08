ALTER TABLE public.fixture_predicted_rating_shares
  ADD COLUMN coach_modifier SMALLINT,
  ADD CONSTRAINT fixture_predicted_rating_shares_coach_modifier_valid
    CHECK (coach_modifier IS NULL OR coach_modifier BETWEEN -10 AND 10);
