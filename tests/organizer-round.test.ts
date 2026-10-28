import assert from 'node:assert/strict';
import test from 'node:test';
import { generateOrganizerPairings, orderFixtureRounds, roundPairingHistory, serializeOrganizerPairings, validateOrganizerPairings, type OrganizerRoundTeam } from '../src/utils/organizer-round.js';
import { buildCalendarSlots } from '../src/utils/hattrick-calendar.js';
import { calculateSeasonSlotStandings } from '../src/utils/standings.js';
import { getFixtureWeekendFlag } from '../src/server/api/_lib/fixture-challenge.js';
import { getRoundDisplayLabel } from '../shared/round-display.js';

const teams: OrganizerRoundTeam[] = Array.from({ length: 160 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i}`, active: i < 130, reserve_active: i >= 130 && i < 150, country_name: 'Latvia', league_level: 4 }));

test('round labels show Unscored only from the persisted scoring flag', () => {
  const scheduled = { round_number: 4, reserved_slot_date: '2030-03-20T00:00:00Z' };
  const extra = { round_number: 8, round_source: 'organizer', reserved_slot_kind: 'weekend_friendly', reserved_slot_date: '2030-03-23T00:00:00Z' };
  assert.equal(getRoundDisplayLabel({ ...extra, is_unscored: true }, [scheduled, extra]), 'Round 4 .5 Weekend Extra · Unscored');
  assert.equal(getRoundDisplayLabel(extra, [scheduled, extra]), 'Round 4 .5 Weekend Extra');
  assert.equal(getRoundDisplayLabel({ ...scheduled, is_unscored: true }, [scheduled]), 'Round 4 · Unscored');
});

test('large mixed rosters pair every selected team exactly once, including odd fields', () => {
  for (const field of [teams, teams.slice(0, 159)]) {
    const roster = field.map(team => ({ teamId: team.id, participation: 'round_only' as const }));
    const pairs = generateOrganizerPairings(field, []);
    assert.equal(pairs.length, Math.ceil(field.length / 2));
    assert.equal(validateOrganizerPairings(roster, pairs), null);
    assert.equal(pairs.filter(pair => !pair.homeTeamId || !pair.awayTeamId).length, field.length % 2);
  }
});

test('editable previews reject duplicates, missing teams, foreign teams and empty fixtures', () => {
  const roster = teams.slice(0, 2).map(team => ({ teamId: team.id, participation: 'round_only' as const }));
  const pair = { homeTeamId: teams[0].id, awayTeamId: teams[1].id, isBye: false };
  assert.equal(validateOrganizerPairings(roster, [pair]), null);
  assert.match(validateOrganizerPairings(roster, [{ ...pair, awayTeamId: pair.homeTeamId }])!, /only once/);
  assert.match(validateOrganizerPairings(roster, [{ ...pair, awayTeamId: null }])!, /Every selected team/);
  assert.match(validateOrganizerPairings(roster, [{ ...pair, awayTeamId: 'outsider' }])!, /selected roster/);
  assert.match(validateOrganizerPairings(roster, [{ ...pair, homeTeamId: null, awayTeamId: null }])!, /empty/);
  assert.equal(validateOrganizerPairings(roster, [{ ...pair, awayTeamId: null }, { ...pair, homeTeamId: null }]), null);
});

test('pairing history excludes unplayed containment and keeps real opponents', () => {
  const played = { home_team_id: 'a', away_team_id: 'b', completed: true, status: 'finished' };
  const history = roundPairingHistory([played, { ...played, completed: false, status: 'misarranged', schedule_resolution: 'finalized_unplayed' }]);
  assert.deepEqual(history.playedPairs, [['a', 'b']]);
  assert.equal(history.homeCounts?.a, 1);
});

test('weekend metadata uses the weekend CHPP window and computes exact planned instants', () => {
  const slot = buildCalendarSlots(new Date('2026-10-26T00:00:00Z'), 16, { includeWeek15WeekendFriendly: true }).find(slot => slot.htWeek === 15 && slot.kind === 'weekend_friendly')!;
  assert.ok(slot);
  assert.equal(getFixtureWeekendFlag(slot.kind), 1);
  assert.equal(getFixtureWeekendFlag('week15_weekend_friendly'), 1);
  assert.equal(getFixtureWeekendFlag('midweek_friendly'), 0);
  const fixtures = serializeOrganizerPairings(slot, [{ homeTeamId: teams[0].id, awayTeamId: teams[1].id, isBye: false }], teams);
  assert.ok(Number.isFinite(new Date(fixtures[0].scheduled_for).getTime()));
});

test('extra rounds display by date without renumbering frozen regular or playoff rounds', () => {
  const rounds = [
    { round_number: 1, reserved_slot_date: '2030-03-20T00:00:00Z', round_source: 'scheduled' },
    { round_number: 2, reserved_slot_date: '2030-03-27T00:00:00Z', round_source: 'scheduled' },
    { round_number: 3, reserved_slot_date: '2030-03-23T00:00:00Z', round_source: 'organizer', round_participants: [{ team_id: 'guest' }] },
  ];
  assert.deepEqual(orderFixtureRounds(rounds).map(round => round.round_number), [1, 3, 2]);
  assert.deepEqual(rounds.map(round => round.round_number), [1, 2, 3]);
});

test('counted Lobby and Past participants retain their own table results without becoming Active', () => {
  const members = ['active', 'lobby', 'past', 'unselected'].map((id, index) => ({ id, name: id, ht_team_id: index + 1, hattrick_user_id: index + 1, active: id === 'active', reserve_active: id === 'lobby', replacement_for_team_id: null }));
  const results = [
    { home_team_id: 'active', away_team_id: 'lobby', home_goals: 1, away_goals: 0, completed: true },
    { home_team_id: 'past', away_team_id: 'active', home_goals: 2, away_goals: 0, completed: true },
  ];
  const table = calculateSeasonSlotStandings(members, results, [], 'points', [], true);
  assert.deepEqual(new Set(table.map(row => row.teamId)), new Set(['active', 'lobby', 'past']));
  assert.equal(table.find(row => row.teamId === 'active')?.played, 2);
  assert.equal(table.find(row => row.teamId === 'past')?.pts, 3);
  assert.equal(members.find(row => row.id === 'past')?.active, false);
});


test('two legacy registrations of the same Hattrick club cannot play twice in one round', () => {
  const roster = [{ teamId: 'old-row', participation: 'round_only' as const }, { teamId: 'current-row', participation: 'round_only' as const }];
  const field = roster.map(row => ({ id: row.teamId, name: row.teamId, ht_team_id: 123, active: row.teamId === 'current-row', reserve_active: false }));
  assert.match(validateOrganizerPairings(roster, [{ homeTeamId: 'old-row', awayTeamId: 'current-row', isBye: false }], field)!, /each Hattrick club once/);
});
