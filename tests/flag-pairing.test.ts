import assert from 'node:assert/strict';
import test from 'node:test';
import { getLeagueWorldDetails } from '../shared/worlddetails.js';
import { createFlagDraft, type FlagHunterTeam, type FlagCollection } from '../shared/flag-hunters.js';
import { analyzeFlagRoster, createScarcityDraft, FLAG_COUNTRIES, reviewFlagDraft } from '../shared/flag-pairing.js';
import { canFlagTeamsPair, maximumFlagMatching } from '../shared/flag-matching.js';

const team = (id: number, country = 1, managerId: number | null = id): FlagHunterTeam => ({ id: `local-${id}`, htTeamId: id, name: `Team ${id}`,
  managerId, managerName: `Manager ${managerId}`, countryName: getLeagueWorldDetails(country)!.leagueName,
  countryId: getLeagueWorldDetails(country)!.countryId, flagCountryId: country, leagueId: country, managerCountryId: null, genderId: 1 });
const needs = (t: FlagHunterTeam, home: number[] = [], away = home): FlagCollection => ({ htTeamId: t.htTeamId, managerId: t.managerId,
  leagueId: t.leagueId, home: FLAG_COUNTRIES.filter(id => !home.includes(id)), away: FLAG_COUNTRIES.filter(id => !away.includes(id)),
  homeUnknown: false, awayUnknown: false, fetchedAt: '2026-10-14T19:00:00Z' });
const flagsFor = (roster: FlagHunterTeam[]) => Object.fromEntries(roster.map(t => [String(t.htTeamId), needs(t)]));

test('scarcity assigns Yemen to flexible A and the sole Guam donor to constrained B, even after a worse random matching', () => {
  const roster = [team(1, 1), team(2, 2), team(3, 154), team(4, 133)];
  const flags = { ...flagsFor(roster), '1': needs(roster[0], [154, 133]), '2': needs(roster[1], [154]) };
  let seed: string | undefined;
  for (let i = 0; i < 100; i++) if (reviewFlagDraft(createFlagDraft(roster, flags, String(i)), roster, flags).summary.gainingTeams < 2) { seed = String(i); break; }
  assert.ok(seed, 'fixture must start with a worse random assignment');
  const draft = createScarcityDraft(roster, flags, seed), review = reviewFlagDraft(draft, roster, flags, draft.analysis);
  assert.equal(review.summary.gainingTeams, 2); assert.equal(review.rows.find(row => row.teamId === 2)?.priority, 1);
  assert.equal(review.rows.find(row => row.teamId === 2)?.gainCountryId, 154);
  assert.equal(review.rows.find(row => row.teamId === 1)?.gainCountryId, 133);
});

test('sole Guam competition respects priority and explains the unavoidable missed gain', () => {
  const roster = [team(1, 133), team(2, 1), team(3, 154), team(4, 2)];
  const flags = { ...flagsFor(roster), '1': needs(roster[0], [154]), '2': needs(roster[1], [154]) };
  const draft = createScarcityDraft(roster, flags, 'sole'), review = reviewFlagDraft(draft, roster, flags, draft.analysis);
  assert.equal(review.summary.gainingTeams, 1); assert.equal(review.summary.complete, 2);
  assert.equal(review.summary.missedCollectors, 1);
  const collecting = review.rows.filter(row => row.priority !== null);
  assert.equal(collecting[0].teamId, 1); // Known rarer Yemen wins the population tie-break.
  assert.equal(collecting[0].gainCountryId, 154); assert.equal(collecting[1].gainCountryId, null);
  assert.match(collecting[1].explanation, /Shared shortage.*at least 1 must miss/);
});

test('three collectors sharing two donors expose a shared shortage instead of three independent feasible gains', () => {
  const roster = [team(1, 1), team(2, 2), team(3, 3), team(4, 154), team(5, 133), team(6, 4)];
  const flags = { ...flagsFor(roster), ...Object.fromEntries(roster.slice(0, 3).map(t => [String(t.htTeamId), needs(t, [154, 133])])) };
  const draft = createScarcityDraft(roster, flags, 'shared'), review = reviewFlagDraft(draft, roster, flags, draft.analysis);
  assert.ok(draft.analysis.shortages.some(group => group.teamIds.length === 3 && group.opponentIds.length === 2 && group.minimumMisses === 1));
  assert.equal(review.summary.gainingTeams, 2); assert.equal(review.summary.missedCollectors, 1); assert.equal(draft.pairs.length, 3);
});

test('complete, unavailable and unknown data are separate; completed teams remain donors without scarcity priority', () => {
  const roster = [team(1, 154), team(2, 1), team(3, 2), team(4, 3)];
  const flags = { ...flagsFor(roster), '2': needs(roster[1], [154]), '3': needs(roster[2], [124]) };
  delete flags['4'];
  const analysis = analyzeFlagRoster(roster, flags, 'status');
  assert.equal(analysis.priorities.find(row => row.teamId === 1)?.status, 'complete');
  assert.equal(analysis.priorities.find(row => row.teamId === 1)?.priority, null);
  assert.equal(analysis.priorities.find(row => row.teamId === 3)?.status, 'unavailable');
  assert.equal(analysis.priorities.find(row => row.teamId === 4)?.status, 'unknown');
  assert.deepEqual(analysis.priorities.find(row => row.teamId === 2)?.usefulOpponentIds, [1]);
  const review = reviewFlagDraft(createScarcityDraft(roster, flags, 'status'), roster, flags);
  assert.equal(review.summary.missedCollectors, 0); assert.equal(review.summary.complete, 1); assert.equal(review.summary.unknown, 1);
});

test('priority uses manager MAX home+away, not a sum across teams, and distinct opponents count once across venues', () => {
  const roster = [team(1, 1, 10), team(2, 1, 10), team(3, 1, 20), team(4, 154, 30)];
  const flags = flagsFor(roster);
  for (const t of roster.slice(0, 3)) {
    const count = t.managerId === 10 ? 20 : 30;
    flags[String(t.htTeamId)] = { ...needs(t), home: FLAG_COUNTRIES.slice(0, count), away: FLAG_COUNTRIES.slice(0, count) };
  }
  const rows = analyzeFlagRoster(roster, flags, 'max').priorities;
  assert.equal(rows[0].teamId, 3); assert.equal(rows[0].managerTotal, 60);
  assert.equal(rows.find(row => row.teamId === 1)?.managerTotal, 40);
  assert.equal(rows.find(row => row.teamId === 1)?.usefulOpponentIds.length, 1);
});

test('manager coverage cannot displace a higher-priority constrained team whose manager has another gain', () => {
  const roster = [team(1, 1, 10), team(2, 2, 10), team(3, 3, 20), team(4, 154, 30), team(5, 133, 40), team(6, 4, 50)];
  const flags = { ...flagsFor(roster), '1': needs(roster[0], [154]), '2': needs(roster[1], [133]), '3': needs(roster[2], [154, 124]) };
  const draft = createScarcityDraft(roster, flags, 'coverage'), review = reviewFlagDraft(draft, roster, flags, draft.analysis);
  assert.equal(review.rows.find(row => row.teamId === 1)?.gainCountryId, 154);
  assert.equal(review.rows.find(row => row.teamId === 2)?.gainCountryId, 133);
  assert.equal(review.rows.find(row => row.teamId === 3)?.gainCountryId, null);
});

test('odd BYE preserves collecting opportunity and prefers a manager with another team; override is explicit', () => {
  const roster = [team(1, 1, 10), team(2, 2, 10), team(3, 3, 20), team(4, 4, 30), team(5, 5, 40)];
  const flags = { ...flagsFor(roster), '3': needs(roster[2], [1, 2]) };
  const draft = createScarcityDraft(roster, flags, 'bye');
  assert.equal(roster.find(t => t.htTeamId === draft.byeId)?.managerId, 10); assert.equal(draft.pairs.length, 2);
  assert.equal(reviewFlagDraft(draft, roster, flags).rows.find(row => row.teamId === 3)?.result, 'gain');
  const forced = createScarcityDraft(roster, flags, 'bye', 3);
  assert.equal(forced.byeId, 3); assert.match(forced.byeReason!, /Organizer BYE override/); assert.equal(forced.pairs.length, 2);
  assert.throws(() => createScarcityDraft(roster.slice(0, 4), flags, 'bye', 1), /odd roster/);
});

test('seed and input-order reproducibility; known gender conflicts and same-manager pairings are excluded in both modes', () => {
  const roster = [team(1, 1, 10), team(2, 2, 10), { ...team(3, 3, 20), genderId: 2 }, { ...team(4, 4, 30), genderId: 2 }, team(5, 5, 40)];
  const flags = flagsFor(roster);
  assert.deepEqual(createScarcityDraft(roster, flags, 'same'), createScarcityDraft([...roster].reverse(), flags, 'same'));
  for (const draft of [createScarcityDraft(roster, flags, 'same'), createFlagDraft(roster, flags, 'same')]) {
    const ids = [...draft.pairs.flatMap(pair => [pair.homeId, pair.awayId]), ...draft.unresolvedIds, ...(draft.byeId === null ? [] : [draft.byeId])];
    assert.equal(new Set(ids).size, roster.length);
    for (const pair of draft.pairs) assert.ok(canFlagTeamsPair(roster.find(t => t.htTeamId === pair.homeId)!, roster.find(t => t.htTeamId === pair.awayId)!));
  }
});

test('general matching agrees with exhaustive matching on small manager/gender graphs, including odd cycles', () => {
  const brute = (roster: FlagHunterTeam[]): number => {
    if (roster.length < 2) return 0;
    const [first, ...rest] = roster;
    return Math.max(brute(rest), ...rest.map((opponent, i) => canFlagTeamsPair(first, opponent) ? 1 + brute(rest.filter((_, j) => i !== j)) : 0));
  };
  for (let sample = 0; sample < 120; sample++) {
    const roster = Array.from({ length: sample % 8 + 1 }, (_, i) => ({ ...team(i + 1, 1, (sample * (i + 3) + i * i) % 4 + 1), genderId: (sample + i * i) % 3 || null }));
    assert.equal(maximumFlagMatching(roster, String(sample)).pairs.length, brute(roster));
  }
});


test('three-match reassignment can preserve two earlier gains while adding a later collecting gain', () => {
  const roster = [team(1, 133), team(2, 139), team(3, 2), team(4, 3), team(5, 154), team(6, 124), team(7, 111), team(8, 104)];
  const flags = { ...flagsFor(roster), '1': needs(roster[0], [154, 124]), '2': needs(roster[1], [124, 111]),
    '3': needs(roster[2], [154, 104]), '4': needs(roster[3], [104]) };
  let seed: string | undefined;
  for (let i = 0; i < 4000; i++) {
    const baseline = createFlagDraft(roster, flags, String(i));
    const opponents = new Map(baseline.pairs.flatMap(pair => [[pair.homeId, pair.awayId], [pair.awayId, pair.homeId]]));
    if (opponents.get(1) === 5 && opponents.get(2) === 6 && opponents.get(3) === 7 && opponents.get(4) === 8) { seed = String(i); break; }
  }
  assert.ok(seed, 'fixture requires a seeded three-cycle');
  const draft = createScarcityDraft(roster, flags, seed), review = reviewFlagDraft(draft, roster, flags, draft.analysis);
  assert.equal(review.summary.gainingTeams, 4);
  assert.equal(review.rows.find(row => row.teamId === 3)?.gainCountryId, 154);
  assert.equal(review.rows.find(row => row.teamId === 1)?.gainCountryId, 124);
  assert.equal(review.rows.find(row => row.teamId === 2)?.gainCountryId, 111);
});


test('odd structurally blocked rosters distinguish one parity BYE from additional unresolved teams', () => {
  const roster = [team(1, 1, 10), team(2, 2, 10), team(3, 3, 10), team(4, 4, 10), team(5, 5, 10)];
  const flags = flagsFor(roster);
  for (const draft of [createScarcityDraft(roster, flags, 'blocked'), createFlagDraft(roster, flags, 'blocked')]) {
    assert.equal(draft.pairs.length, 0); assert.ok(draft.byeId); assert.equal(draft.unresolvedIds.length, 4);
  }
  const unidentified = createScarcityDraft([team(1, 1, null)], {}, 'identity');
  assert.equal(unidentified.byeId, null); assert.deepEqual(unidentified.unresolvedIds, [1]);
});
