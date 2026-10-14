import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFlagCountryId, pairBenefits, type FlagHunterTeam } from '../shared/flag-hunters.js';
import { createScarcityDraft } from '../shared/flag-pairing.js';
import { HATTRICK_WORLD_DETAILS } from '../shared/worlddetails.js';
import { buildFlagHuntersLengthScheduleDraft } from '../src/server/api/_lib/flag-hunters-schedule.js';
import { buildLengthScheduleDraft, serializeLengthScheduleDraft } from '../src/utils/length-schedule.js';
import { buildRoundRobinCycles } from '../src/utils/round-robin-cycles.js';

const countries = Object.values(HATTRICK_WORLD_DETAILS).filter(item => item.countryId !== null).slice(0, 6);
const roster: FlagHunterTeam[] = countries.map((country, i) => ({
  id: `team-${i + 1}`, htTeamId: 100 + i, name: `Team ${i + 1}`,
  managerId: i + 1, managerName: `Manager ${i + 1}`, managerCountryId: null,
  countryId: country.countryId, countryName: country.leagueName,
  leagueId: country.leagueId, flagCountryId: resolveFlagCountryId(country.countryId), genderId: 1,
}));
const participants = roster.map(team => ({ id: team.id, name: team.name,
  ht_team_id: team.htTeamId, hattrick_user_id: team.managerId, country_id: team.countryId,
  country_name: team.countryName, league_id: team.leagueId, gender_id: team.genderId ?? null,
}));
const cached = Object.fromEntries(roster.map(team => [String(team.htTeamId), {
  htTeamId: team.htTeamId, managerId: team.managerId, leagueId: team.leagueId,
  home: [], away: [], homeUnknown: false, awayUnknown: false, fetchedAt: '2026-10-14T12:00:00Z',
}]));
const profiles = roster.map(team => ({ hattrick_user_id: team.managerId!, teams_json: [{
  teamId: team.htTeamId, countryId: team.countryId, leagueId: team.leagueId,
  homeFlagLeagueIds: [], awayFlagLeagueIds: [], flagsFetchedAt: '2026-10-14T12:00:00Z',
}] }));
const input = { teams: roster.map(team => ({ id: team.id, name: team.name, countryName: team.countryName,
  teamRank: null, powerRating: null, leagueLevel: 1 })), rankingSource: 'power_rating' as const,
  startSlotId: 'S95-W14-midweek', now: new Date('2026-10-14T12:00:00Z') };

test('Generate reads current persisted flag fields and changes only the opener', () => {
  const standard = buildLengthScheduleDraft(input);
  const flagged = buildFlagHuntersLengthScheduleDraft(input, participants, profiles);
  assert.equal(standard.valid, true);
  assert.equal(flagged.valid, true);
  const expected = createScarcityDraft(roster, cached, 'round-one');
  const htIds = new Map(roster.map(team => [team.id, team.htTeamId]));
  const first = flagged.rounds[0]!.matches.map(match => ({ homeId: htIds.get(match.homeTeamId!)!, awayId: htIds.get(match.awayTeamId!)! }));
  assert.deepEqual(first.sort((a, b) => a.homeId - b.homeId), expected.pairs);
  assert.equal(first.reduce((gains, pair) => {
    const benefits = pairBenefits(pair, roster, cached);
    return gains + Number(benefits.home === 'gain') + Number(benefits.away === 'gain');
  }, 0), 6);
  assert.deepEqual(flagged.rankingSnapshot, standard.rankingSnapshot);
  assert.deepEqual(flagged.formats, standard.formats);
  assert.deepEqual(flagged.rounds.map(round => [round.roundNumber, round.slot, round.phase, round.phaseStatus]),
    standard.rounds.map(round => [round.roundNumber, round.slot, round.phase, round.phaseStatus]));
  const payload = serializeLengthScheduleDraft(flagged);
  assert.equal(payload.rounds[0]!.matches.length, 3);
  assert.ok(payload.rounds.slice(1).every(round => round.matches.length === 0));
  const indexIds = new Map(flagged.rankingSnapshot.map(team => [team.seed, team.team_id]));
  assert.deepEqual(payload.regular_pairings[0]!.map(pair => [indexIds.get(pair.home_slot_index), indexIds.get(pair.away_slot_index!)]),
    flagged.rounds[0]!.matches.map(match => [match.homeTeamId, match.awayTeamId]));
});

test('unknown collections remain unknown while live arrivals and departures change the roster', () => {
  const newcomer = { ...participants[0]!, id: 'new-team', name: 'New arrival', ht_team_id: 99999999, hattrick_user_id: 99999999 };
  const oddInput = { ...input, teams: [...input.teams, { ...input.teams[0]!, id: newcomer.id, name: newcomer.name }] };
  const odd = buildFlagHuntersLengthScheduleDraft(oddInput, [...participants, newcomer], profiles);
  assert.equal(odd.teamCount, 7);
  assert.equal(odd.rounds[0]!.matches.filter(pair => pair.isBye).length, 1);
  assert.ok(odd.rounds[0]!.matches.some(pair => pair.homeTeamId === newcomer.id || pair.awayTeamId === newcomer.id));
  const withdrawnInput = { ...input, teams: input.teams.slice(1) };
  const withdrawn = buildFlagHuntersLengthScheduleDraft(withdrawnInput, participants, profiles);
  assert.ok(withdrawn.rounds[0]!.matches.every(pair => pair.homeTeamId !== participants[0]!.id && pair.awayTeamId !== participants[0]!.id));
  const changed = participants.map(team => ({ ...team, hattrick_user_id: 123 }));
  assert.throws(() => buildFlagHuntersLengthScheduleDraft(input, changed, profiles), /cannot be fully paired/);
});

test('unverified or changed country records never become assumed missing flags', () => {
  const stale = profiles.map((profile, i) => i === 0 ? { ...profile, teams_json: [{ ...profile.teams_json[0]!, countryId: 999 }] } : profile);
  const flagged = buildFlagHuntersLengthScheduleDraft(input, participants, stale);
  const unknown = createScarcityDraft(roster, { ...cached, [String(roster[0]!.htTeamId)]: undefined! }, 'round-one');
  assert.equal(flagged.rounds[0]!.matches.length, 3);
  assert.equal(unknown.analysis.priorities.find(row => row.teamId === roster[0]!.htTeamId)?.status, 'unknown');
});

test('opening relabeling preserves complete cycles, repeated venues, BYEs and home balance', () => {
  for (const count of [4, 5, 8, 9]) for (const rounds of [1, 2, count - 1, count, count * 2 + 1]) {
    const ids = Array.from({ length: count }, (_, i) => `team-${i}`);
    const original = buildRoundRobinCycles(ids, rounds);
    const reversed = [...ids].reverse();
    const opening = Array.from({ length: Math.ceil(count / 2) }, (_, i) => ({
      homeTeamId: reversed[i * 2]!, awayTeamId: reversed[i * 2 + 1] ?? null, isBye: i * 2 + 1 >= count,
    }));
    const altered = buildRoundRobinCycles(ids, rounds, opening);
    assert.deepEqual(new Set(altered[0]!.map(p => `${p.homeTeamId}:${p.awayTeamId}`)), new Set(opening.map(p => `${p.homeTeamId}:${p.awayTeamId}`)));
    const appearances = (plan: typeof original) => [...new Map(ids.map(id => [id, plan.flat().reduce((total, pair) =>
      total + Number(pair.homeTeamId === id && !pair.isBye) - Number(pair.awayTeamId === id), 0)])).values()].sort();
    assert.deepEqual(appearances(altered), appearances(original));
    for (const round of altered) assert.deepEqual(round.flatMap(pair => [pair.homeTeamId, pair.awayTeamId]).filter(Boolean).sort(), [...ids].sort());
    const cycleSize = count % 2 ? count : count - 1;
    const firstCycle = altered.slice(0, cycleSize).flat().filter(pair => !pair.isBye).map(pair => [pair.homeTeamId, pair.awayTeamId].sort().join(':'));
    assert.equal(new Set(firstCycle).size, firstCycle.length);
  }
  assert.throws(() => buildRoundRobinCycles(['a', 'b'], 1, [{ homeTeamId: 'a', awayTeamId: 'a', isBye: false }]), /every active team/);
});
