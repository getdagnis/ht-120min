import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatTournamentName, formatTournamentSlug, stripGeneratedTournamentNameSuffix } from '../../../utils/tournament-names.js';
import { fetchTeamDetailsFromChpp, type ManagerChppCredentials } from './matchmaker.js';

interface EffectiveRosterTeam {
  id: string;
  name: string;
  ht_team_id: number | null;
  active: boolean | null;
  is_placeholder: boolean | null;
  reserve_active: boolean | null;
  manager_name: string | null;
}

interface CurrentSeasonSlot {
  current_team_id: string | null;
}

export function selectEffectiveRoster(
  teams: EffectiveRosterTeam[],
  currentSeasonSlots: CurrentSeasonSlot[],
): EffectiveRosterTeam[] {
  const eligible = teams.filter(
    (team) => team.ht_team_id && !team.is_placeholder && !team.reserve_active,
  );
  if (currentSeasonSlots.length > 0) {
    const occupantIds = new Set(
      currentSeasonSlots.map((slot) => slot.current_team_id).filter((id): id is string => Boolean(id)),
    );
    return eligible.filter((team) => occupantIds.has(team.id));
  }
  return eligible.filter((team) => team.active === true);
}

export function buildSandboxCopyIdentity(sourceName: string, now = new Date()) {
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
  const name = formatTournamentName(
    `${stripGeneratedTournamentNameSuffix(sourceName)} sandbox ${timestamp}`,
    { registrationType: 'sandbox' },
  );
  return {
    name,
    slug: formatTournamentSlug(name, 'sandbox'),
    adminPassword: randomBytes(6).toString('base64url'),
  };
}

export async function loadSandboxSnapshotInput(
  supabase: SupabaseClient,
  input: {
    sourceTournamentId: string;
    consumerKey: string;
    consumerSecret: string;
    credentials: Pick<ManagerChppCredentials, 'oauth_token' | 'oauth_token_secret'>;
  },
) {
  const { data: source, error: sourceError } = await supabase
    .from('tournaments')
    .select('id, name, season, league_category, is_test, registration_type')
    .eq('id', input.sourceTournamentId)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error('Source tournament not found.');
  if (source.is_test || source.registration_type === 'sandbox') {
    throw new Error('Only real tournaments can be duplicated as sandboxes.');
  }

  const [{ data: teams, error: teamsError }, { data: season, error: seasonError }] = await Promise.all([
    supabase
      .from('teams')
      .select('id, name, ht_team_id, active, is_placeholder, reserve_active, manager_name')
      .eq('tournament_id', input.sourceTournamentId),
    supabase
      .from('tournament_seasons')
      .select('id')
      .eq('tournament_id', input.sourceTournamentId)
      .eq('season_number', Number(source.season) || 1)
      .maybeSingle(),
  ]);
  if (teamsError) throw teamsError;
  if (seasonError) throw seasonError;

  const { data: slots, error: slotsError } = season?.id
    ? await supabase
        .from('tournament_season_slots')
        .select('current_team_id')
        .eq('tournament_season_id', season.id)
    : { data: [], error: null };
  if (slotsError) throw slotsError;

  const roster = selectEffectiveRoster(
    (teams || []) as EffectiveRosterTeam[],
    (slots || []) as CurrentSeasonSlot[],
  );
  if (roster.length < 2) throw new Error('The source tournament has fewer than two current participants.');

  const refreshedTeams = [];
  for (const team of roster) {
    const details = await fetchTeamDetailsFromChpp(
      input.consumerKey,
      input.consumerSecret,
      input.credentials,
      Number(team.ht_team_id),
    );
    if (source.league_category === 'hfi' && !details.teamRank) {
      throw new Error(`CHPP did not return an HFI rank for ${details.teamName || team.name}.`);
    }
    refreshedTeams.push({
      source_team_id: team.id,
      ht_team_id: Number(team.ht_team_id),
      name: details.teamName || team.name,
      logo_url: details.logoUrl || null,
      country_name: details.countryName || null,
      country_id: details.countryId ?? null,
      league_id: details.leagueId ?? null,
      gender_id: details.genderId ?? null,
      league_level: details.leagueLevel ?? null,
      team_rank: details.teamRank ?? null,
      power_rating: details.powerRating ?? null,
      power_global_rank: details.powerGlobalRank ?? null,
      power_league_rank: details.powerLeagueRank ?? null,
      power_region_rank: details.powerRegionRank ?? null,
      manager_name: team.manager_name || null,
    });
  }

  return { source, teams: refreshedTeams };
}
