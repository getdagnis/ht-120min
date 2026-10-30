import type { RoundWithMatches, Team } from '../legacy-pages/Public/TournamentView';

export type TeamRisk = 'critical' | 'high' | 'medium' | 'low' | 'none' | 'unknown';
export type TeamNow = 'played' | 'booked' | 'unbooked' | 'conflict' | 'bye' | 'no-fixture' | 'unknown' | 'none';

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatTeamJoinedAge(joinedAt: string, now: number) {
  const joined = Date.parse(joinedAt);
  if (!Number.isFinite(joined)) return '—';
  if (!now) return '—';
  const days = Math.max(0, Math.floor((now - joined) / DAY_MS));
  const weeks = Math.floor(days / 7);
  if (weeks === 0) return `${days}d`;
  const remainingDays = days % 7;
  return weeks <= 3 && remainingDays ? `${weeks}.${remainingDays}w` : `${weeks}w`;
}

export interface TeamTableStats {
  played: number;
  misarranged: number | null;
  fixture: boolean | null;
  risk: TeamRisk;
  now: TeamNow;
  latestMisarrangedRound: number;
  riskReason: string;
}

interface WarningRow { team_id: string; round_id: string; reason: string; active?: boolean }
interface AssignmentRow { team_id: string | null; assigned_at: string; released_at: string | null }

const isRegularRound = (round: RoundWithMatches) =>
  round.phase !== 'postseason' && round.is_unscored !== true && round.round_source !== 'organizer';

const isResolvedRound = (round: RoundWithMatches) =>
  round.phase_status === 'completed' ||
  (round.phase_status == null && round.matches.length > 0 &&
    round.matches.every((match) => match.completed || match.status === 'misarranged'));

const effectiveTeamIds = (match: RoundWithMatches['matches'][number]) => {
  const ids = [match.home_team_id, match.away_team_id];
  if (match.reserve_team_id && match.reserve_replaces_team_id) {
    const index = ids.indexOf(match.reserve_replaces_team_id);
    if (index >= 0) ids[index] = match.reserve_team_id;
  }
  return ids;
};

const isExpected = (team: Team, round: RoundWithMatches, assignments: AssignmentRow[]): boolean | null => {
  if (!round.matches.length) return null;
  if (round.round_participants?.some((entry) => entry.team_id === team.id)) return true;
  const moment = Date.parse(round.reserved_slot_date || round.created_at);
  const relevant = assignments.filter((entry) => entry.team_id === team.id);
  if (relevant.length && Number.isFinite(moment)) {
    return relevant.some((entry) => Date.parse(entry.assigned_at) <= moment &&
      (!entry.released_at || Date.parse(entry.released_at) > moment));
  }
  if (round.phase_status === 'materialized' && team.active && Number.isFinite(moment) &&
    Date.parse(team.created_at) <= moment) return true;
  return null;
};

export function getAdminTeamTableStats(
  team: Team,
  rounds: RoundWithMatches[],
  warnings: WarningRow[] | null,
  assignments: AssignmentRow[],
): TeamTableStats {
  const regular = rounds.filter(isRegularRound).sort((a, b) => a.round_number - b.round_number);
  const regularRoundIds = new Set(regular.map((round) => round.id));
  const currentRoundIds = new Set(regular.filter((round) => round.phase_status === 'materialized').map((round) => round.id));
  const warningRoundIds = warnings === null ? null : new Set(warnings
    .filter((warning) => regularRoundIds.has(warning.round_id) && warning.team_id === team.id && warning.reason === 'misarranged' &&
      (!currentRoundIds.has(warning.round_id) || warning.active !== false))
    .map((warning) => warning.round_id));
  let played = 0;
  let noFixture = false;
  let noFixtureKnown = true;
  let latestMisarrangedRound = 0;
  const eligible: Array<{ round: number; misarranged: boolean }> = [];

  for (const round of regular) {
    if (round.phase_status === 'pending') continue;
    const match = round.matches.find((item) => effectiveTeamIds(item).includes(team.id));
    if (!match && Date.parse(team.created_at) > Date.parse(round.reserved_slot_date || round.created_at)) continue;
    const warned = warningRoundIds?.has(round.id) ?? false;
    if (warned) latestMisarrangedRound = round.round_number;
    if (!match) {
      const expectation = isExpected(team, round, assignments);
      if (expectation === true) {
        noFixture = true;
      } else if (expectation === null) {
        noFixtureKnown = false;
      }
      continue;
    }
    const bye = !match.home_team_id || !match.away_team_id;
    if (bye) continue;
    if (match.completed) played += 1;
    if (isResolvedRound(round) || warned) {
      eligible.push({ round: round.round_number, misarranged: warned });
    }
  }

  const latestFour = eligible.slice(-4);
  const failures = latestFour.filter((entry) => entry.misarranged).length;
  const risk: TeamRisk = warningRoundIds === null ? 'unknown'
    : failures >= 3 ? 'critical'
      : failures === 2 ? (latestFour.at(-1)?.misarranged ? 'high' : 'medium')
        : failures === 1 ? 'low' : 'none';
  const warnedRounds = latestFour.filter((entry) => entry.misarranged).map((entry) => `R${entry.round}`);
  const riskReason = warningRoundIds === null
    ? 'Warning history is unavailable.'
    : latestFour.length === 0 ? 'No eligible rounds yet.'
    : `${failures} misarranged ${failures === 1 ? 'round' : 'rounds'} in the last ${latestFour.length} eligible ${latestFour.length === 1 ? 'round' : 'rounds'}` +
      `${warnedRounds.length ? ` (${warnedRounds.join(', ')})` : ''}.` +
      (risk === 'high' ? ' The latest eligible round was misarranged.'
        : risk === 'medium' ? ' The latest eligible round was not misarranged.' : '');
  const currentRound = regular.find((round) => round.phase_status === 'materialized') ||
    regular.find((round) => round.phase_status == null && round.matches.length > 0 && !isResolvedRound(round));
  const currentMatch = currentRound?.matches.find((item) => effectiveTeamIds(item).includes(team.id));
  let now: TeamNow = 'none';
  if (currentRound) {
    if (!currentMatch) {
      const expectation = isExpected(team, currentRound, assignments);
      now = expectation === true ? 'no-fixture' : expectation === null ? 'unknown' : 'none';
    }
    else if (!currentMatch.home_team_id || !currentMatch.away_team_id) now = 'bye';
    else if (currentMatch.status === 'misarranged') now = 'conflict';
    else if (currentMatch.completed) now = 'played';
    else if (['arranged', 'ongoing'].includes(currentMatch.status)) now = 'booked';
    else now = 'unbooked';
  }
  return {
    played,
    misarranged: warningRoundIds?.size ?? null,
    fixture: noFixtureKnown || noFixture ? !noFixture : null,
    risk,
    now,
    latestMisarrangedRound,
    riskReason,
  };
}
