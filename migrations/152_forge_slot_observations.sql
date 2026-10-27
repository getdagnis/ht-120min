-- Forge availability snapshots are independent of organizer verification receipts.
BEGIN;
CREATE TABLE public.forge_slot_observations (
  slot_id text NOT NULL,
  ht_team_id bigint NOT NULL CHECK (ht_team_id > 0),
  checked_at timestamptz NOT NULL,
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation) = 'object'),
  PRIMARY KEY (slot_id, ht_team_id)
);
ALTER TABLE public.forge_slot_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.forge_slot_observations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.forge_slot_observations TO service_role;
COMMIT;

-- applied!