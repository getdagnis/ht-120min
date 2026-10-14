import assert from 'node:assert/strict';
import test from 'node:test';
import { createFlagDraft, draftMetrics, flagBenefit, pairBenefits, parseFlagSnapshot, reconcileFlagSnapshot,
  type FlagCollection, type FlagHunterTeam, type FlagSnapshot } from '../shared/flag-hunters.js';
import { parseFlagHunterDetails } from '../src/server/api/testing/flag-hunters.js';
const team = (id: number, managerId: number | null = id): FlagHunterTeam => ({ id: `local-${id}`, htTeamId: id,
  managerId, managerName: `Manager ${managerId}`, name: `Team ${id}`, countryName: 'Display name', leagueId: id + 100 });
const collection = (t: FlagHunterTeam, home: number[] = [], away: number[] = []): FlagCollection => ({
  htTeamId: t.htTeamId, managerId: t.managerId, leagueId: t.leagueId, home, away, fetchedAt: '2026-10-14T08:00:00Z',
});
const snapshot = (teams: FlagHunterTeam[], flags: Record<string, FlagCollection> = {}): FlagSnapshot => ({
  version: 1, tournamentId: 'tournament', savedAt: '2026-10-14T08:00:00Z', teams, flags,
});

test('A hosting B checks B LeagueID in A HOME and A LeagueID in B AWAY, independently', () => {
  const a = team(1), b = team(2);
  const flags = { '1': collection(a, [], [102]), '2': collection(b, [101], []) };
  assert.deepEqual(pairBenefits({ homeId: 1, awayId: 2 }, [a, b], flags), { home: 'gain', away: 'gain' });
  assert.deepEqual(pairBenefits({ homeId: 2, awayId: 1 }, [a, b], flags), { home: 'none', away: 'none' });
  assert.deepEqual(createFlagDraft([a, b], flags, 'seed').pairs, [{ homeId: 1, awayId: 2 }]);
});

test('unfetched differs from confirmed empty; missing opponent league and changed owner remain unknown', () => {
  const a = team(1), b = team(2);
  assert.equal(flagBenefit(a, b, 'home', {}), 'unknown');
  assert.equal(flagBenefit(a, b, 'home', { '1': collection(a) }), 'gain');
  assert.equal(flagBenefit(a, { ...b, leagueId: null }, 'home', { '1': collection(a) }), 'unknown');
  assert.equal(flagBenefit({ ...a, managerId: 55 }, b, 'home', { '1': collection(a) }), 'unknown');
});

test('all small manager distributions achieve the theoretical maximum without duplicate or same-manager pairs', () => {
  for (let a = 0; a <= 6; a++) for (let b = 0; b <= 6; b++) for (let c = 0; c <= 6; c++) {
    let id = 0;
    const roster = [a, b, c].flatMap((count, group) => Array.from({ length: count }, () => team(++id, group + 1)));
    const draft = createFlagDraft(roster, {}, `${a}-${b}-${c}`);
    const n = a + b + c;
    assert.equal(draft.pairs.length, Math.min(Math.floor(n / 2), n - Math.max(a, b, c)));
    const ids = [...draft.pairs.flatMap(pair => [pair.homeId, pair.awayId]), ...draft.unresolvedIds, ...(draft.byeId ? [draft.byeId] : [])];
    assert.equal(new Set(ids).size, n); assert.equal(ids.length, n);
    for (const pair of draft.pairs) assert.notEqual(roster.find(t => t.htTeamId === pair.homeId)?.managerId, roster.find(t => t.htTeamId === pair.awayId)?.managerId);
  }
});

test('seed is reproducible independent of input order; odd BYE and manager-constrained leftovers are distinct', () => {
  const roster = [team(1), team(2), team(3), team(4), team(5)];
  assert.deepEqual(createFlagDraft(roster, {}, 'repeat'), createFlagDraft([...roster].reverse(), {}, 'repeat'));
  const odd = createFlagDraft(roster, {}, 'repeat'); assert.ok(odd.byeId); assert.deepEqual(odd.unresolvedIds, []);
  const blocked = createFlagDraft([team(1, 10), team(2, 10), team(3, 10), team(4, 20)], {}, 'repeat');
  assert.equal(blocked.byeId, null); assert.equal(blocked.unresolvedIds.length, 2);
  assert.deepEqual(createFlagDraft([team(1, null)], {}, 'repeat').unresolvedIds, [1]);
  assert.throws(() => createFlagDraft([team(1), team(1)], {}, 'seed'), /Duplicate/);
});

test('venue swaps and updated flags recalculate gains, mutual matches, zero benefits and unknowns', () => {
  const roster = [team(1), team(2), team(3), team(4)];
  const flags = { '1': collection(roster[0], [], [102]), '2': collection(roster[1], [101], []), '3': collection(roster[2], [104]) };
  const draft = { seed: 'metrics', pairs: [{ homeId: 1, awayId: 2 }, { homeId: 3, awayId: 4 }], byeId: null, unresolvedIds: [] };
  assert.deepEqual(draftMetrics(draft, roster, flags), { gaining: 2, both: 1, nothing: 1, unknown: 1 });
  assert.deepEqual(draftMetrics({ ...draft, pairs: [{ homeId: 2, awayId: 1 }] }, roster, flags), { gaining: 0, both: 0, nothing: 2, unknown: 0 });
  assert.deepEqual(draftMetrics(draft, roster, { ...flags, '4': collection(roster[3]) }), { gaining: 3, both: 1, nothing: 1, unknown: 0 });
});

test('snapshots validate structure, strip arbitrary properties and reject other tournaments or duplicates', () => {
  const a = team(1); const saved = snapshot([a], { '1': collection(a) });
  assert.deepEqual(parseFlagSnapshot(JSON.parse(JSON.stringify(saved))), saved);
  const imported = parseFlagSnapshot({ ...saved, oauth_token: 'must-not-survive', flags: { '1': { ...collection(a), secret: 'no' } } });
  assert.equal('oauth_token' in imported, false); assert.equal('secret' in imported.flags['1'], false);
  assert.throws(() => parseFlagSnapshot({ ...saved, teams: [a, a] }), /duplicate/);
  assert.throws(() => parseFlagSnapshot({ ...saved, flags: { '1': { ...collection(a), home: ['101'] } } }), /Invalid/);
  assert.throws(() => reconcileFlagSnapshot(saved, 'other', [a]), /another tournament/);
});

test('reconcile names new, departed and changed teams and removes incompatible flag data', () => {
  const a = team(1), b = team(2), c = team(3), d = team(4);
  const saved = snapshot([a, b, c], { '1': collection(a), '2': collection(b), '3': collection(c) });
  const result = reconcileFlagSnapshot(saved, 'tournament', [a, { ...b, managerId: 999 }, d]);
  assert.deepEqual(result.missing, [4]); assert.deepEqual(result.departed, [3]); assert.deepEqual(result.changed, [2]);
  assert.deepEqual(Object.keys(result.flags), ['1']);
  assert.deepEqual(Object.keys(reconcileFlagSnapshot(saved, 'tournament', [{ ...a, leagueId: 333 }]).flags), []);
});

const xml = (flags: string, id = 1) => `<HattrickData><Teams><Team><TeamID>${id}</TeamID><League><LeagueID>101</LeagueID></League>${flags}</Team></Teams></HattrickData>`;
test('CHPP response accepts explicitly empty lists and extracts directional LeagueIDs, not country IDs', () => {
  assert.deepEqual(parseFlagHunterDetails(xml('<Flags><HomeFlags/><AwayFlags></AwayFlags></Flags>'), 1), { leagueId: 101, home: [], away: [] });
  assert.deepEqual(parseFlagHunterDetails(xml('<Flags><HomeFlags><Flag><LeagueID>154</LeagueID><CountryID>999</CountryID></Flag></HomeFlags><AwayFlags><Flag><LeagueID>3</LeagueID></Flag></AwayFlags></Flags>'), 1), { leagueId: 101, home: [154], away: [3] });
  assert.throws(() => parseFlagHunterDetails(xml(''), 1), /omitted/);
  assert.throws(() => parseFlagHunterDetails(xml('<Flags><HomeFlags/></Flags>'), 1), /omitted/);
  assert.throws(() => parseFlagHunterDetails(xml('<Flags><HomeFlags/><AwayFlags/></Flags>', 2), 1), /requested team/);
  assert.throws(() => parseFlagHunterDetails('<ErrorCode>7</ErrorCode>', 1), /returned an error/);
});

// Sanitized reproduction of the supplied live response: AwayFlags first,
// mixed-case LeagueId tags, and multiple teams belonging to the same manager.
test('live-shaped multi-team response keeps mixed-case flag IDs scoped to the selected team', () => {
  const response = `<HattrickData><Teams>
    <Team><TeamID>1</TeamID><League><LeagueID>53</LeagueID></League><Flags>
      <AwayFlags><Flag><LeagueId>44</LeagueId></Flag><Flag><LeagueId>139</LeagueId></Flag></AwayFlags>
      <HomeFlags><Flag><LeagueId>62</LeagueId></Flag><Flag><LeagueId>34</LeagueId></Flag></HomeFlags>
    </Flags></Team>
    <Team><TeamID>2</TeamID><League><LeagueID>3000</LeagueID></League><Flags>
      <AwayFlags><Flag><LeagueId>154</LeagueId></Flag><Flag><LeagueId>143</LeagueId></Flag></AwayFlags>
      <HomeFlags><Flag><LeagueId>11</LeagueId></Flag><Flag><LeagueId>3</LeagueId></Flag></HomeFlags>
    </Flags></Team>
  </Teams></HattrickData>`;
  assert.deepEqual(parseFlagHunterDetails(response, 1), { leagueId: 53, home: [34, 62], away: [44, 139] });
  assert.deepEqual(parseFlagHunterDetails(response, 2), { leagueId: 3000, home: [3, 11], away: [143, 154] });
});
