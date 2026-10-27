-- Prepared only. Apply before deploying persisted daily Spotlight selection.
create table public.daily_manager_spotlights (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  utc_date date not null,
  participant jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, utc_date)
);
alter table public.daily_manager_spotlights enable row level security;
revoke all on public.daily_manager_spotlights from public, anon, authenticated;
grant select, insert on public.daily_manager_spotlights to service_role;

create function public.resolve_daily_manager_spotlight(p_tournament_id uuid, p_utc_date date, p_participant jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare selected jsonb;
begin
  if p_utc_date <> (now() at time zone 'UTC')::date then
    raise exception 'Invalid selection date';
  end if;
  if p_participant is not null then
    if coalesce((p_participant->>'hattrick_user_id')::bigint, 0) <= 0
       or coalesce((p_participant->>'ht_team_id')::bigint, 0) <= 0 then
      raise exception 'Invalid participant';
    end if;
    insert into public.daily_manager_spotlights(tournament_id, utc_date, participant)
      values (p_tournament_id, p_utc_date, p_participant)
      on conflict (tournament_id, utc_date) do nothing;
  end if;
  select participant into selected from public.daily_manager_spotlights
    where tournament_id = p_tournament_id and utc_date = p_utc_date;
  return selected;
end;
$$;
revoke all on function public.resolve_daily_manager_spotlight(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.resolve_daily_manager_spotlight(uuid, date, jsonb) to service_role;
