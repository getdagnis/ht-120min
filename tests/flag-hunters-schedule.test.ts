import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import approved from '../src/server/api/_lib/approved-around-the-world-opening.json' with { type: 'json' };
import { buildFlagHuntersLengthScheduleDraft } from '../src/server/api/_lib/flag-hunters-schedule.js';
import { buildLengthScheduleDraft, serializeLengthScheduleDraft } from '../src/utils/length-schedule.js';
import { buildRoundRobinCycles } from '../src/utils/round-robin-cycles.js';

// Read the approved source independently of the bundled JSON conversion.
const csv = readFileSync(new URL('../plans/round-one-manager-priority.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
const csvRows = csv.slice(1).map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1]!.replaceAll('""', '"')));
const source = csvRows.map(row => ({ homeTeam: row[0], awayTeam: row[1], homeTeamId: Number(row[2]), awayTeamId: Number(row[3]) }));
const participants = approved.flatMap((pair, index) => [
  { id: `db-home-${index}`, name: pair.homeTeam, ht_team_id: pair.homeTeamId, hattrick_user_id: index * 2 + 1,
    country_id: 1, country_name: 'Sweden', league_id: 1, gender_id: 1 },
  { id: `db-away-${index}`, name: pair.awayTeam, ht_team_id: pair.awayTeamId, hattrick_user_id: index * 2 + 2,
    country_id: 2, country_name: 'England', league_id: 2, gender_id: 1 },
]);
const input = { teams: participants.map(team => ({ id: team.id, name: team.name, countryName: team.country_name,
  teamRank: null, powerRating: null, leagueLevel: 1 })), rankingSource: 'power_rating' as const,
  startSlotId: 'S95-W14-midweek', now: new Date('2026-10-14T12:00:00Z') };

test('all 73 approved CSV opponents and venues survive the actual generator serialization', () => {
  assert.equal(source.length, 73);
  assert.deepEqual(approved, source);
  const standard = buildLengthScheduleDraft(input);
  const draft = buildFlagHuntersLengthScheduleDraft(input, [...participants].reverse());
  assert.equal(draft.valid, true);
  const payload = serializeLengthScheduleDraft(draft);
  const htIds = new Map(participants.map(team => [team.id, team.ht_team_id]));
  const expected = source.map(pair => `${pair.homeTeamId}:${pair.awayTeamId}`).sort();
  assert.equal(payload.rounds[0]!.matches.length, 73);
  assert.deepEqual(payload.rounds[0]!.matches.map(match => `${htIds.get(match.home_team_id!)}:${htIds.get(match.away_team_id!)}`).sort(), expected);
  assert.ok(payload.rounds[0]!.matches.every(match => !match.is_bye && match.venue_type === 'home_away'));
  const seeds = new Map(draft.rankingSnapshot.map(team => [team.seed, htIds.get(team.team_id)]));
  assert.deepEqual(payload.regular_pairings[0]!.map(pair => `${seeds.get(pair.home_slot_index)}:${seeds.get(pair.away_slot_index!)}`).sort(), expected);
  assert.deepEqual(draft.rankingSnapshot, standard.rankingSnapshot);
  assert.deepEqual(draft.formats, standard.formats);
  assert.deepEqual(draft.rounds.map(round => [round.roundNumber, round.slot, round.phase, round.phaseStatus]),
    standard.rounds.map(round => [round.roundNumber, round.slot, round.phase, round.phaseStatus]));
  assert.ok(payload.rounds.slice(1).every(round => round.matches.length === 0));
});

test('roster changes stop generation and list added and removed identities', () => {
  const changed = participants.map((team, i) => i === 0 ? { ...team, name: 'New arrival', ht_team_id: 99999999 } : team);
  assert.throws(() => buildFlagHuntersLengthScheduleDraft(input, changed), /Added: New arrival \(99999999\).*Removed: The Mosi Mambas \(2260624\)/);
});

test('invalid identities, duplicate appearances and current same-manager opponents stop generation', () => {
  for (const field of ['ht_team_id', 'hattrick_user_id'] as const) {
    assert.throws(() => buildFlagHuntersLengthScheduleDraft(input, participants.map((team, i) => i === 0 ? { ...team, [field]: 0 } : team)), /valid Hattrick/);
  }
  assert.throws(() => buildFlagHuntersLengthScheduleDraft(input, participants.map((team, i) => i === 1 ? { ...team, ht_team_id: participants[0]!.ht_team_id } : team)), /Duplicate Hattrick/);
  assert.throws(() => buildFlagHuntersLengthScheduleDraft(input, participants.map((team, i) => i === 1 ? { ...team, hattrick_user_id: participants[0]!.hattrick_user_id } : team)), /same-manager/);
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
