-- Private, replaceable lists for the admin-only Forge Leagues helper.
-- Not team identity, tournament registration, consent or authenticated profiles.
create table public.forge_league_snapshots (
  league_id integer primary key check (league_id > 0),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot->'teams') = 'array'
    and jsonb_array_length(snapshot->'teams') <= 600
  ),
  revision integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.forge_league_snapshots enable row level security;
revoke all on public.forge_league_snapshots from public, anon, authenticated;
grant select, insert, update, delete on public.forge_league_snapshots to service_role;
comment on table public.forge_league_snapshots is
  'One private list snapshot per explicitly scanned small league; temporary discovery queues are cleared at completion.';

-- applied!