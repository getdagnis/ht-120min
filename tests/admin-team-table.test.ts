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

test('risk uses distinct misarranged rounds in the last four eligible rounds', () => {
  const rounds = [1, 2, 3, 4].map((number) => round(number, 'finished'));
  const critical = getAdminTeamTableStats(team, rounds, [warning(1), warning(1), warning(2), warning(3)], []);
  assert.equal(critical.risk, 'critical');
  assert.match(critical.riskReason, /3 misarranged rounds in the last 4 eligible rounds \(R1, R2, R3\)/);
  assert.equal(getAdminTeamTableStats(team, rounds, [warning(1), warning(4)], []).risk, 'high');
  assert.equal(getAdminTeamTableStats(team, rounds, [warning(1), warning(2)], []).risk, 'medium');
  assert.equal(getAdminTeamTableStats(team, rounds, [warning(1), { ...warning(2), reason: 'in_cup' }], []).risk, 'low');
  assert.equal(getAdminTeamTableStats(team, rounds, [], []).risk, 'none');
});

test('an active current-round warning affects risk while a withdrawn warning does not', () => {
  const rounds = [round(1, 'finished'), round(2, 'finished'), round(3, 'finished'),
    round(4, 'misarranged', { phaseStatus: 'materialized' })];
  assert.equal(getAdminTeamTableStats(team, rounds, [warning(1), warning(2), { ...warning(4), active: true }], []).risk, 'critical');
  assert.equal(getAdminTeamTableStats(team, rounds, [{ ...warning(4), active: false }], []).risk, 'none');
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

test('BYEs are separate from no fixture and pending rounds do not count', () => {
  const rounds = [round(1, 'finished', { bye: true }), round(2, 'finished', { missing: true }),
    round(3, 'not_arranged', { missing: true, phaseStatus: 'pending' })];
  const assignments = [{ team_id: team.id, assigned_at: '2026-01-01T00:00:00Z', released_at: null }];
  const stats = getAdminTeamTableStats(team, rounds, [], assignments);
  assert.equal(stats.noFixture, 1);
  assert.equal(stats.noFixtureUncertain, false);
  assert.equal(stats.played, 0);
  assert.equal(stats.risk, 'none');
});

test('unknown past membership does not become a zero no-fixture count', () => {
  const stats = getAdminTeamTableStats(team, [round(1, 'finished', { missing: true })], [], []);
  assert.equal(stats.noFixture, null);
  assert.equal(stats.noFixtureUncertain, true);
});

test('late joins and released slot assignments do not create false no-fixture counts', () => {
  const lateTeam = { ...team, created_at: '2026-01-03T00:00:00Z' };
  const beforeJoin = getAdminTeamTableStats(lateTeam, [round(1, 'finished', { missing: true })], [], []);
  assert.equal(beforeJoin.noFixture, 0);
  assert.equal(beforeJoin.noFixtureUncertain, false);
  const replaced = getAdminTeamTableStats(team, [round(2, 'finished', { missing: true })], [], [
    { team_id: team.id, assigned_at: '2026-01-01T00:00:00Z', released_at: '2026-01-01T20:00:00Z' },
  ]);
  assert.equal(replaced.noFixture, 0);
});

test('GM includes misarranged fixtures but not pending unbooked games', () => {
  const rounds = [round(1, 'misarranged'), round(2, 'not_arranged'), round(3, 'not_arranged', { phaseStatus: 'materialized' })];
  const stats = getAdminTeamTableStats(team, rounds, [warning(1)], []);
  assert.equal(stats.missed, 2);
  assert.equal(stats.now, 'unbooked');
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
