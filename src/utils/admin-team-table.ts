import type { RoundWithMatches, Team } from '../legacy-pages/Public/TournamentView';
import { getRoundDisplayLabel } from '../../shared/round-display';

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
  misarrangedRounds: string[] | null;
  fixture: boolean | null;
  fixtureRounds: Array<{ roundId: string; label: string; status: 'yes' | 'no' | 'bye' | 'not-selected' }>;
  risk: TeamRisk;
  now: TeamNow;
  nextRoundLabel: string | null;
  nextOpponentName: string | null;
  nextOwnWarning: boolean | null;
  latestMisarrangedRound: number;
  riskReason: string;
}

interface WarningRow { team_id: string; round_id: string; reason: string; active?: boolean }
interface AssignmentRow { team_id: string | null; assigned_at: string; released_at: string | null }

const isRegularRound = (round: RoundWithMatches) =>
  round.phase !== 'postseason' && round.is_unscored !== true;

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
  if (round.round_source === 'organizer') {
    return round.round_participants?.some((entry) => entry.team_id === team.id) ?? null;
  }
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
  focusedRoundId?: string | null,
): TeamTableStats {
  const regular = rounds.filter(isRegularRound);
  const regularRoundIds = new Set(regular.map((round) => round.id));
  const currentRoundIds = new Set(regular.filter((round) => round.phase_status === 'materialized').map((round) => round.id));
  const warningRoundIds = warnings === null ? null : new Set(warnings
    .filter((warning) => regularRoundIds.has(warning.round_id) && warning.team_id === team.id && warning.reason === 'misarranged' &&
      (!currentRoundIds.has(warning.round_id) || warning.active !== false))
    .map((warning) => warning.round_id));
  const misarrangedRounds = warningRoundIds === null ? null : regular
    .filter((round) => warningRoundIds.has(round.id))
    .map((round) => getRoundDisplayLabel(round, rounds));
  let played = 0;
  let latestMisarrangedRound = 0;
  const eligible: Array<{ label: string; misarranged: boolean }> = [];

  for (const [index, round] of regular.entries()) {
    const warned = warningRoundIds?.has(round.id) ?? false;
    if (round.phase_status === 'pending' && !warned) continue;
    const match = round.matches.find((item) => effectiveTeamIds(item).includes(team.id));
    if (!match && !warned && Date.parse(team.created_at) > Date.parse(round.reserved_slot_date || round.created_at)) continue;
    if (warned) latestMisarrangedRound = index + 1;
    if (!match || !match.home_team_id || !match.away_team_id) {
      if (warned) eligible.push({ label: getRoundDisplayLabel(round, rounds), misarranged: true });
      continue;
    }
    if (match.completed) played += 1;
    if (isResolvedRound(round) || warned) {
      eligible.push({ label: getRoundDisplayLabel(round, rounds), misarranged: warned });
    }
  }

  const latestFive = eligible.slice(-5);
  const failures = latestFive.filter((entry) => entry.misarranged).length;
  const risk: TeamRisk = warningRoundIds === null ? 'unknown'
    : failures >= 3 ? 'critical'
      : failures === 2 ? (latestFive.at(-1)?.misarranged ? 'high' : 'medium')
        : failures === 1 ? 'low' : 'none';
  const warnedRounds = latestFive.filter((entry) => entry.misarranged).map((entry) => entry.label);
  const riskReason = warningRoundIds === null
    ? 'Warning history is unavailable.'
    : latestFive.length === 0 ? 'No eligible rounds yet.'
    : `${failures} misarranged ${failures === 1 ? 'round' : 'rounds'} in the last ${latestFive.length} eligible ${latestFive.length === 1 ? 'round' : 'rounds'}` +
      `${warnedRounds.length ? ` (${warnedRounds.join(', ')})` : ''}.` +
      (risk === 'high' ? ' The latest eligible round was misarranged.'
        : risk === 'medium' ? ' The latest eligible round was not misarranged.' : '');
  const focusedIndex = focusedRoundId === undefined ? 0
    : focusedRoundId === null ? -1 : rounds.findIndex((round) => round.id === focusedRoundId);
  const openRounds = (focusedIndex < 0 ? [] : rounds.slice(focusedIndex)).filter((round) =>
    round.phase !== 'postseason' && round.is_unscored !== true &&
    (round.phase_status === 'materialized' || round.phase_status == null) &&
    round.matches.some((match) => !match.completed && match.status !== 'misarranged'));
  const openMatches = openRounds.map((round) => ({
    round,
    match: round.matches.find((item) => effectiveTeamIds(item).includes(team.id)),
  }));
  const fixtureRounds: TeamTableStats['fixtureRounds'] = openMatches.map(({ round, match }) => ({
    roundId: round.id,
    label: getRoundDisplayLabel(round, rounds),
    status: match
      ? match.home_team_id && match.away_team_id ? 'yes' : 'bye'
      : isExpected(team, round, assignments) === true ? 'no' : 'not-selected',
  }));
  const next = openMatches.find(({ match }) => match && !match.completed) ||
    openMatches.find(({ round, match }) => !match && isExpected(team, round, assignments) === true);
  const currentRound = next?.round;
  const currentMatch = next?.match;
  const opponentId = currentMatch && effectiveTeamIds(currentMatch).find((id) => id && id !== team.id);
  const nextOpponentName = !currentMatch || !opponentId ? null
    : opponentId === currentMatch.reserve_team_id ? currentMatch.reserve_team?.name || null
      : opponentId === currentMatch.home_team_id ? currentMatch.home_team?.name || null
        : currentMatch.away_team?.name || null;
  const fixture = fixtureRounds.some((entry) => entry.status === 'no') ? false
    : fixtureRounds.some((entry) => entry.status === 'yes') ? true : null;
  let now: TeamNow = 'none';
  if (currentRound) {
    if (!currentMatch) {
      now = isExpected(team, currentRound, assignments) === true ? 'no-fixture' : 'none';
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
    misarrangedRounds,
    fixture,
    fixtureRounds,
    risk,
    now,
    nextRoundLabel: currentRound ? getRoundDisplayLabel(currentRound, rounds) : null,
    nextOpponentName,
    nextOwnWarning: currentRound && warningRoundIds ? warningRoundIds.has(currentRound.id) : null,
    latestMisarrangedRound,
    riskReason,
  };
}
