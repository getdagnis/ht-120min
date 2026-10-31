import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTeamJoinedAge, getAdminTeamTableStats } from '../src/utils/admin-team-table.js';
import type { RoundWithMatches, Team } from '../src/legacy-pages/Public/TournamentView.js';

const team = { id: 'team-a', tournament_id: 't', name: 'A', ht_team_id: 1, active: true,
  created_at: '2026-01-01T00:00:00Z' } as Team;

function round(number: number, status: RoundWithMatches['matches'][number]['status'], options: {
  bye?: boolean; missing?: boolean; completed?: boolean; phaseStatus?: RoundWithMatches['phase_status'];
} = {}): RoundWithMatches {
  return {
    id: `round-${number}`, round_number: number, created_at: `2026-01-${String(number).padStart(2, '0')}T00:00:00Z`,
    reserved_slot_date: `2026-01-${String(number).padStart(2, '0')}T12:00:00Z`,
    phase: 'regular', phase_status: options.phaseStatus || 'completed',
    matches: options.missing ? [{ id: `other-${number}`, round_id: `round-${number}`, home_team_id: 'other', away_team_id: 'third',
      completed: true, status: 'finished' }] as RoundWithMatches['matches'] : [{
      id: `match-${number}`, round_id: `round-${number}`, home_team_id: team.id,
      away_team_id: options.bye ? null : 'other', completed: options.completed ?? status === 'finished', status,
    }] as RoundWithMatches['matches'],
  };
}

const warning = (number: number) => ({ team_id: team.id, round_id: `round-${number}`, reason: 'misarranged', active: false });

test('risk uses distinct attributed warnings in the last five eligible rounds', () => {
  const rounds = [1, 2, 3, 4].map((number) => round(number, 'finished'));
  const critical = getAdminTeamTableStats(team, rounds, [warning(1), warning(1), warning(2), warning(3)], []);
  assert.equal(critical.risk, 'critical');
  assert.equal(critical.misarranged, 3);
  assert.match(critical.riskReason, /3 misarranged rounds in the last 4 eligible rounds \(Round 1, Round 2, Round 3\)/);
  assert.equal(getAdminTeamTableStats(team, rounds, [warning(1), warning(4)], []).risk, 'high');
  assert.equal(getAdminTeamTableStats(team, rounds, [warning(1), warning(2)], []).risk, 'medium');
  assert.equal(getAdminTeamTableStats(team, rounds, [warning(1), { ...warning(2), reason: 'in_cup' }], []).risk, 'low');
  assert.equal(getAdminTeamTableStats(team, rounds, [], []).risk, 'none');
  const sixRounds = [1, 2, 3, 4, 5, 6].map((number) => round(number, 'finished'));
  const fiveRoundWindow = getAdminTeamTableStats(team, sixRounds, [warning(1), warning(2), warning(3)], []);
  assert.equal(fiveRoundWindow.misarranged, 3);
  assert.equal(fiveRoundWindow.risk, 'medium');
});

test('an active current-round warning affects risk while a withdrawn warning does not', () => {
  const rounds = [round(1, 'finished'), round(2, 'finished'), round(3, 'finished'),
    round(4, 'misarranged', { phaseStatus: 'materialized' })];
  const active = getAdminTeamTableStats(team, rounds, [warning(1), warning(2), { ...warning(4), active: true }], []);
  assert.equal(active.risk, 'critical');
  assert.equal(active.misarranged, 3);
  const withdrawn = getAdminTeamTableStats(team, rounds, [{ ...warning(4), active: false }], []);
  assert.equal(withdrawn.risk, 'none');
  assert.equal(withdrawn.misarranged, 0);
});

test('an upcoming misarrangement counts only with this team’s active warning', () => {
  const current = round(1, 'misarranged', { phaseStatus: 'materialized' });
  const activeRound = { ...current, matches: [...current.matches, {
    ...current.matches[0], id: 'other-1', home_team_id: 'other', away_team_id: 'third', status: 'not_arranged' as const,
  }] };
  const warned = getAdminTeamTableStats(team, [activeRound], [{ ...warning(1), active: true }], []);
  assert.equal(warned.misarranged, 1);
  assert.deepEqual(warned.misarrangedRounds, ['Round 1']);
  assert.equal(warned.now, 'conflict');
  assert.equal(warned.nextRoundLabel, 'Round 1');
  assert.equal(warned.nextOwnWarning, true);

  const opponentWarned = getAdminTeamTableStats(team, [activeRound], [
    { ...warning(1), team_id: 'other', active: true },
  ], []);
  assert.equal(opponentWarned.misarranged, 0);
  assert.deepEqual(opponentWarned.misarrangedRounds, []);
  assert.equal(opponentWarned.now, 'conflict');
  assert.equal(opponentWarned.nextOwnWarning, false);
});

test('risk includes attributed warning rounds even when the old fixture row is missing', () => {
  const rounds = [round(1, 'misarranged'), round(2, 'finished', { missing: true }),
    round(3, 'arranged', { phaseStatus: 'materialized' })];
  const stats = getAdminTeamTableStats(team, rounds, [warning(1), warning(2)], []);
  assert.equal(stats.played, 0);
  assert.equal(stats.misarranged, 2);
  assert.equal(stats.risk, 'high');
  assert.match(stats.riskReason, /2 misarranged rounds/);
});

test('recorded incidents remain visible in legacy rounds awaiting other fixtures', () => {
  const rounds = [1, 2, 3].map((number) => {
    const item = round(number, 'misarranged');
    return { ...item, phase_status: undefined, matches: [...item.matches, {
      ...item.matches[0], id: `other-${number}`, home_team_id: 'other', away_team_id: 'third',
      status: 'not_arranged' as const,
    }] };
  });
  assert.equal(getAdminTeamTableStats(team, rounds, [warning(1), warning(2), warning(3)], []).risk, 'critical');
});

test('misarranged count is unavailable when warning history has not loaded', () => {
  const stats = getAdminTeamTableStats(team, [round(1, 'misarranged')], null, []);
  assert.equal(stats.misarranged, null);
  assert.equal(stats.risk, 'unknown');
});

test('a misarranged fixture does not blame the team without its own warning', () => {
  const stats = getAdminTeamTableStats(team, [round(1, 'misarranged')], [
    { team_id: 'other', round_id: 'round-1', reason: 'misarranged', active: false },
  ], []);
  assert.equal(stats.misarranged, 0);
  assert.equal(stats.risk, 'none');
});

test('organizer-added round warnings count only for the warned team', () => {
  const added = { ...round(2, 'misarranged', { phaseStatus: 'materialized' }),
    round_source: 'organizer' as const, round_participants: [{ team_id: team.id, participation: 'round_only' as const }] };
  const warned = getAdminTeamTableStats(team, [round(1, 'finished'), added], [
    { ...warning(2), active: true },
  ], []);
  assert.equal(warned.misarranged, 1);
  assert.equal(warned.risk, 'low');
  const opponentWarned = getAdminTeamTableStats(team, [round(1, 'finished'), added], [
    { ...warning(2), team_id: 'other', active: true },
  ], []);
  assert.equal(opponentWarned.misarranged, 0);
  assert.equal(opponentWarned.risk, 'none');
});

test('Fixture describes open rounds, not earlier gaps or pending rounds', () => {
  const rounds = [round(1, 'finished', { bye: true }), round(2, 'finished', { missing: true }),
    round(3, 'not_arranged', { phaseStatus: 'materialized' }),
    round(4, 'not_arranged', { missing: true, phaseStatus: 'pending' })];
  const assignments = [{ team_id: team.id, assigned_at: '2026-01-01T00:00:00Z', released_at: null }];
  const stats = getAdminTeamTableStats(team, rounds, [], assignments);
  assert.equal(stats.fixture, true);
  assert.equal(stats.played, 0);
  assert.equal(stats.risk, 'none');
  const conflicted = round(3, 'misarranged', { phaseStatus: 'materialized' });
  const misarranged = getAdminTeamTableStats(team, [round(2, 'finished', { missing: true }),
    { ...conflicted, matches: [...conflicted.matches, {
      ...conflicted.matches[0], id: 'other-3', home_team_id: 'other', away_team_id: 'third', status: 'not_arranged',
    }] }], [], assignments);
  assert.equal(misarranged.fixture, true);
  assert.equal(misarranged.now, 'conflict');
});

test('open round without an assigned opponent is false only for an expected team', () => {
  const current = round(2, 'not_arranged', { missing: true, phaseStatus: 'materialized' });
  current.matches[0] = { ...current.matches[0], completed: false };
  const assignments = [{ team_id: team.id, assigned_at: '2026-01-01T00:00:00Z', released_at: null }];
  assert.equal(getAdminTeamTableStats(team, [round(1, 'finished'), current], [], assignments).fixture, false);
});

test('no current round or unknown current participation does not claim a fixture', () => {
  const stats = getAdminTeamTableStats(team, [round(1, 'finished', { missing: true })], [], []);
  assert.equal(stats.fixture, null);
  const current = round(2, 'not_arranged', { missing: true, phaseStatus: 'materialized' });
  assert.equal(getAdminTeamTableStats(team, [{ ...current, matches: [] }], [], []).fixture, null);
});

test('late joins and released slot assignments do not create false current fixture gaps', () => {
  const lateTeam = { ...team, created_at: '2026-01-03T00:00:00Z' };
  const current = round(1, 'not_arranged', { missing: true, phaseStatus: 'materialized' });
  current.matches[0] = { ...current.matches[0], completed: false };
  const beforeJoin = getAdminTeamTableStats(lateTeam, [current], [], []);
  assert.equal(beforeJoin.fixture, null);
  const later = round(2, 'not_arranged', { missing: true, phaseStatus: 'materialized' });
  later.matches[0] = { ...later.matches[0], completed: false };
  const replaced = getAdminTeamTableStats(team, [later], [], [
    { team_id: team.id, assigned_at: '2026-01-01T00:00:00Z', released_at: '2026-01-01T20:00:00Z' },
  ]);
  assert.equal(replaced.fixture, null);
});

test('Fixture checks open weekend and scheduled rounds from the focused round onward', () => {
  const old = round(1, 'misarranged', { phaseStatus: 'materialized' });
  const weekend = { ...round(2, 'arranged', { missing: true, phaseStatus: 'materialized' }),
    round_source: 'organizer' as const, round_participants: [],
    matches: [{ ...round(2, 'arranged', { missing: true }).matches[0], completed: false, status: 'arranged' as const }] };
  const scheduled = round(3, 'arranged', { phaseStatus: 'materialized' });
  const assignments = [{ team_id: team.id, assigned_at: '2026-01-01T00:00:00Z', released_at: null }];
  const withRoundThree = getAdminTeamTableStats(team, [old, weekend, scheduled], [], assignments, weekend.id);
  assert.equal(withRoundThree.fixture, true);
  assert.deepEqual(withRoundThree.fixtureRounds.map((entry) => entry.status), ['not-selected', 'yes']);
  assert.equal(withRoundThree.now, 'booked');

  const weekendMatch = round(2, 'not_arranged', { phaseStatus: 'materialized' });
  const selectedWeekend = { ...weekend, matches: [...weekend.matches, ...weekendMatch.matches],
    round_participants: [{ team_id: team.id, participation: 'round_only' as const }] };
  const withWeekend = getAdminTeamTableStats(team, [old, selectedWeekend, scheduled], [], assignments, weekend.id);
  assert.equal(withWeekend.fixture, true);
  assert.deepEqual(withWeekend.fixtureRounds.map((entry) => entry.status), ['yes', 'yes']);
  assert.equal(withWeekend.now, 'unbooked');

  const missing = { ...scheduled, matches: weekend.matches };
  const noFixture = getAdminTeamTableStats(team, [old, weekend, missing], [], assignments, weekend.id);
  assert.equal(noFixture.fixture, false);
  assert.deepEqual(noFixture.fixtureRounds.map((entry) => entry.status), ['not-selected', 'no']);
  assert.equal(noFixture.now, 'no-fixture');

  const weekendOnly = getAdminTeamTableStats(team, [old, weekend], [], assignments, weekend.id);
  assert.equal(weekendOnly.fixture, null);
  assert.equal(weekendOnly.now, 'none');
});

test('joined age uses compact week.day labels through week three', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const joined = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(formatTeamJoinedAge(joined(2), 0), '—');
  assert.equal(formatTeamJoinedAge(joined(2), now), '2d');
  assert.equal(formatTeamJoinedAge(joined(10), now), '1.3w');
  assert.equal(formatTeamJoinedAge(joined(22), now), '3.1w');
  assert.equal(formatTeamJoinedAge(joined(27), now), '3.6w');
  assert.equal(formatTeamJoinedAge(joined(28), now), '4w');
  assert.equal(formatTeamJoinedAge(joined(30), now), '4w');
});
