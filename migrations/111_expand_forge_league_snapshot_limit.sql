-- Expand only the private list size limit; retain existing snapshots and RLS.
begin;
alter table public.forge_league_snapshots
  drop constraint forge_league_snapshots_snapshot_check;
alter table public.forge_league_snapshots
  add constraint forge_league_snapshots_snapshot_check check (
    jsonb_typeof(snapshot->'teams') = 'array'
    and jsonb_array_length(snapshot->'teams') <= 1200
  );
commit;

-- applied!