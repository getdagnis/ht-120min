import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchSidePerformance } from '../shared/match-events.js';
import { analyzeMatch120mCoaching, calculateMatch120mRating, normalizeMatch120mGrade, usesMatch120mRatings } from '../shared/match-120m-rating.js';
import { mapMatchEventDetailsToFixture } from '../src/server/api/_lib/chpp-match-events.js';
import { prepareMatch120mRatings, tryRecalculateMatch120mRatings } from '../src/server/api/_lib/match-120m-ratings.js';

const raw = (display: number) => display * 4 - 3;

function setup(overrides: Partial<MatchSidePerformance> = {}): MatchSidePerformance {
  return {
    formation: '5-5-0', tacticType: 1, tacticName: 'Pressing', tacticSkill: 10,
    styleOfPlay: null, setPiecesTaker: { playerName: null, skill: 1, skillCheckedAt: null },
    specialtyPositions: [], possessionFirstHalf: null, possessionSecondHalf: null,
    ratings: {
      leftDefence: raw(10), centralDefence: raw(10), rightDefence: raw(10),
      leftAttack: raw(1), centralAttack: raw(1), rightAttack: raw(1), midfield: raw(2),
    },
    chances: { left: null, centre: null, right: null, specialEvents: null, other: null },
    ...overrides,
  };
}

test('ideal defensive setup reaches A+ without opponent or match result', () => {
  assert.deepEqual(calculateMatch120mRating(setup({ tacticSkill: 15 })), {
    score: 100, grade: 'A+', formula_version: 9, has_set_pieces_skill: true, has_specialties: true,
  });
});

test('strong defence protects the formation deduction while attack and tactic costs still apply', () => {
  const rating = calculateMatch120mRating(setup({
    formation: '2-5-3', tacticType: 4, tacticName: 'Attack on wings',
    ratings: { ...setup().ratings, leftAttack: raw(8) },
  }));
  assert.ok(rating);
  assert.equal(rating.score, 66);
  assert.equal(rating.grade, 'C+');
});

test('unknown optional skill is neutral and missing specialties is not a penalty', () => {
  const unknown = calculateMatch120mRating(setup({ setPiecesTaker: null, specialtyPositions: undefined }));
  const highSkill = calculateMatch120mRating(setup({ setPiecesTaker: { playerName: null, skill: 14, skillCheckedAt: null } }));
  assert.ok(unknown && highSkill);
  assert.equal(unknown.score - highSkill.score, 5);
  assert.equal(unknown.has_set_pieces_skill, false);
  assert.equal(unknown.has_specialties, false);
});

test('defensive Quick players do not count as offensive SE threat, while a dangerous attack sector still costs points', () => {
  const defensive = setup({
    formation: '5-4-1', tacticType: 0, tacticName: 'Normal', styleOfPlay: -1000,
    setPiecesTaker: { playerName: null, skill: 6, skillCheckedAt: null },
    specialtyPositions: [{ specialtyId: 2, roleIds: [100, 101, 102, 103] }],
    ratings: {
      leftDefence: raw(10.5), centralDefence: raw(11.5), rightDefence: raw(7.25),
      leftAttack: raw(8), centralAttack: raw(2.5), rightAttack: raw(3.75), midfield: raw(3.75),
    },
  });
  assert.equal(calculateMatch120mRating(defensive)?.grade, 'B');
});

test('the other reference setups calibrate to Pillars D, Lapsus D, and Bousignies C+', () => {
  const pillars = setup({
    formation: '2-5-3', tacticType: 0, tacticName: 'Normal',
    setPiecesTaker: { playerName: null, skill: 8, skillCheckedAt: null },
    specialtyPositions: [
      { specialtyId: 2, roleIds: [100, 101] },
      { specialtyId: 5, roleIds: [102, 103, 104] },
    ],
    ratings: {
      leftDefence: raw(4.5), centralDefence: raw(7.25), rightDefence: raw(4.5),
      leftAttack: raw(3.25), centralAttack: raw(5.25), rightAttack: raw(3.25), midfield: raw(4.25),
    },
  });
  const lapsus = setup({
    formation: '4-4-2', tacticType: 4, tacticName: 'Attack on wings',
    setPiecesTaker: { playerName: null, skill: 7, skillCheckedAt: null },
    ratings: {
      leftDefence: raw(6.75), centralDefence: raw(6.25), rightDefence: raw(6),
      leftAttack: raw(6), centralAttack: raw(4.25), rightAttack: raw(6), midfield: raw(3),
    },
  });
  const bousignies = setup({
    formation: '5-4-1',
    setPiecesTaker: { playerName: null, skill: 11, skillCheckedAt: null },
    ratings: {
      leftDefence: raw(7.75), centralDefence: raw(9.25), rightDefence: raw(7),
      leftAttack: raw(5.75), centralAttack: raw(6), rightAttack: raw(7), midfield: raw(7),
    },
  });
  assert.equal(calculateMatch120mRating(pillars)?.grade, 'D');
  assert.equal(calculateMatch120mRating(lapsus)?.grade, 'D');
  assert.equal(calculateMatch120mRating(bousignies)?.grade, 'C+');
});

test('grade labels keep only meaningful plus/minus distinctions and normalize older stored labels', () => {
  assert.equal(normalizeMatch120mGrade('A+'), 'A+');
  assert.equal(normalizeMatch120mGrade('A-'), 'A-');
  assert.equal(normalizeMatch120mGrade('B+'), 'B+');
  assert.equal(normalizeMatch120mGrade('B-'), 'B-');
  assert.equal(normalizeMatch120mGrade('C+'), 'C+');
  assert.equal(normalizeMatch120mGrade('C-'), 'C-');
  assert.equal(normalizeMatch120mGrade('F-'), 'F-');
  assert.equal(normalizeMatch120mGrade('D+'), 'D');
  assert.equal(normalizeMatch120mGrade('D-'), 'D');
  assert.equal(normalizeMatch120mGrade('E+'), 'E-');
  assert.equal(normalizeMatch120mGrade('E'), 'E-');
  assert.equal(normalizeMatch120mGrade('F+'), 'F-');
  assert.equal(normalizeMatch120mGrade('F'), 'F-');
});

test('unrecognized or incomplete core data remains unscored', () => {
  assert.equal(calculateMatch120mRating(setup({ formation: 'unknown' })), null);
  assert.equal(calculateMatch120mRating(setup({ ratings: { ...setup().ratings, midfield: null } })), null);
  assert.equal(calculateMatch120mRating(setup({ tacticType: null, tacticName: null })), null);
});

test('120m coaching colors attacks above average defence and flags midfield load by defence coverage', () => {
  const balanced = setup({
    ratings: {
      leftDefence: raw(6), centralDefence: raw(6), rightDefence: raw(6),
      leftAttack: raw(3), centralAttack: raw(3), rightAttack: raw(3), midfield: raw(3),
    },
  });
  assert.deepEqual(analyzeMatch120mCoaching(balanced).sectorScores, {});

  const attackAbove = setup({ ratings: { ...balanced.ratings, leftAttack: raw(6.01) } });
  assert.equal(analyzeMatch120mCoaching(attackAbove).sectorScores.leftAttack, 4);

  const midfieldAtBoundary = setup({
    ratings: { ...balanced.ratings, leftAttack: raw(3), centralAttack: raw(3), rightAttack: raw(3), midfield: raw(9) },
  });
  assert.equal(analyzeMatch120mCoaching(midfieldAtBoundary).sectorScores.midfield, 4);
  const midfieldOver = setup({
    ratings: { ...midfieldAtBoundary.ratings, midfield: raw(9.01) },
  });
  assert.equal(analyzeMatch120mCoaching(midfieldOver).sectorScores.midfield, 4);
});

test('120m coaching always flags defence below 5 and attacks at 8, with a stronger 11.25 warning', () => {
  const weakDefence = setup({ ratings: { ...setup().ratings, leftDefence: raw(4.99) } });
  const weakDefenceAnalysis = analyzeMatch120mCoaching(weakDefence);
  assert.equal(weakDefenceAnalysis.sectorScores.leftDefence, 4);
  assert.ok(weakDefenceAnalysis.recommendations.includes('adviceWeakDefence'));

  const dangerousAttack = setup({ ratings: { ...setup().ratings, leftAttack: raw(8) } });
  const dangerousAnalysis = analyzeMatch120mCoaching(dangerousAttack);
  assert.equal(dangerousAnalysis.sectorScores.leftAttack, 4);
  assert.ok(dangerousAnalysis.recommendations.includes('adviceDangerousAttack'));

  const veryHighAttack = setup({ ratings: { ...setup().ratings, leftAttack: raw(11.25) } });
  const veryHighAnalysis = analyzeMatch120mCoaching(veryHighAttack);
  assert.equal(veryHighAnalysis.sectorScores.leftAttack, 4);
  assert.ok(veryHighAnalysis.recommendations.includes('adviceVeryHighAttack'));
  assert.ok(!veryHighAnalysis.recommendations.includes('adviceDangerousAttack'));
});

test('120m coaching flags three Quick, Head, or Unpredictable players and only rewards Quick defensive cover', () => {
  const base = setup({ specialtyPositions: [
    { specialtyId: 2, roleIds: [101, 102, 103] },
    { specialtyId: 5, roleIds: [104, 105, 106] },
    { specialtyId: 4, roleIds: [107, 108, 109] },
  ] });
  const analysis = analyzeMatch120mCoaching(base, [{ specialtyId: 2, roleIds: [110] }]);
  assert.ok(analysis.quickDefensiveRoles.includes(101));
  assert.equal(analysis.sectorScores.rightDefence, undefined);
  assert.ok(analysis.recommendations.includes('reduceQuick'));
  assert.ok(analysis.recommendations.includes('reduceHead'));
  assert.ok(analysis.recommendations.includes('reduceUnpredictable'));
  assert.ok(!analysis.recommendations.includes('setDefensiveStyle'));

  const technical = setup({ specialtyPositions: [{ specialtyId: 1, roleIds: [101] }] });
  const technicalAnalysis = analyzeMatch120mCoaching(technical, [{ specialtyId: 2, roleIds: [110] }]);
  assert.deepEqual(technicalAnalysis.quickDefensiveRoles, []);
});

test('rough SE threat discounts average skill fit and excludes Unpredictable goalkeepers', () => {
  const baseline = calculateMatch120mRating(setup());
  const withThreat = calculateMatch120mRating(setup({ specialtyPositions: [
    { specialtyId: 2, roleIds: [110, 111] },
    { specialtyId: 5, roleIds: [101] },
    { specialtyId: 4, roleIds: [102] },
    { specialtyId: 1, roleIds: [107, 108] },
    { specialtyId: 3, roleIds: [105] },
  ] }));
  const withUnpredictableKeeper = calculateMatch120mRating(setup({ specialtyPositions: [
    { specialtyId: 2, roleIds: [110, 111] },
    { specialtyId: 5, roleIds: [101] },
    { specialtyId: 4, roleIds: [100] },
  ] }));
  assert.ok(baseline && withThreat && withUnpredictableKeeper);
  assert.equal(baseline.score - withThreat.score, 6);
  assert.equal(baseline.score - withUnpredictableKeeper.score, 5);
});

test('only 120-minute scoring modes are eligible', () => {
  for (const mode of ['120m', '120min', 'average120', 'appg']) assert.equal(usesMatch120mRatings(mode), true);
  for (const mode of ['points', null, 'unknown']) assert.equal(usesMatch120mRatings(mode), false);
});

test('reversed venues keep distinct performances with their fixture participants, including a reserve', async () => {
  const rawDetails = {
    version: 3 as const, source: 'matchdetails-3.1' as const,
    actualHomeTeamId: 202, actualAwayTeamId: 303,
    home: { teamId: 202, cards: [], injuries: [], performance: setup({
      formation: '2-5-3', tacticType: 4, tacticName: 'Attack on wings',
      ratings: { ...setup().ratings, leftAttack: raw(8) },
    }) },
    away: { teamId: 303, cards: [], injuries: [], performance: setup() },
  };
  const mappedDetails = mapMatchEventDetailsToFixture(rawDetails, 101, 202, [303]);
  const match = {
    id: 'fixture', round_id: 'round', completed: true,
    match_event_details: mappedDetails, home_team_id: 'old-home', away_team_id: 'away',
    reserve_team_id: 'reserve', reserve_replaces_team_id: 'old-home',
    actual_ht_home_team_id: 202, actual_ht_away_team_id: 303,
    home_team: { id: 'old-home', ht_team_id: 101 },
    away_team: { id: 'away', ht_team_id: 202 },
    reserve_team: { id: 'reserve', ht_team_id: 303 },
  };
  const rows: Record<string, unknown> = {
    matches: match,
    tournaments: { scoring_mode: 'appg', season: 1 },
    rounds: { tournament_id: 'tournament', season_number: 1 },
  };
  const queries: Array<{ table: string; columns: string; filters: Record<string, unknown> }> = [];
  const supabase = { from: (table: string) => ({
    select(columns: string) { queries.push({ table, columns, filters: {} }); return this; },
    eq(column: string, value: unknown) { queries.at(-1)!.filters[column] = value; return this; },
    async maybeSingle() { return { data: rows[table], error: null }; },
    async single() { return { data: rows[table], error: null }; },
  }) } as unknown as SupabaseClient;
  const result = await prepareMatch120mRatings(supabase, 'fixture');
  assert.equal(result?.home?.team_id, 'reserve');
  assert.equal(result?.home?.ht_team_id, 303);
  assert.equal(result?.home?.grade, 'A+');
  assert.equal(result?.away?.team_id, 'away');
  assert.equal(result?.away?.grade, 'F-');
  assert.equal(queries[0].columns.includes('tournament_id'), false);
  assert.equal(queries[1].columns, 'tournament_id,season_number');
  assert.equal(queries[2].filters.id, 'tournament');
  match.match_event_details = rawDetails;
  const legacy = await prepareMatch120mRatings(supabase, 'fixture');
  assert.equal(legacy?.home?.grade, 'A+');
  assert.equal(legacy?.away?.grade, 'F-');
  match.actual_ht_home_team_id = 999;
  assert.equal(await prepareMatch120mRatings(supabase, 'fixture'), null);
});

test('rating database failures are returned for reporting instead of escaping into progression', async () => {
  const supabase = { from: () => ({
    select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: null, error: { code: '42703', message: 'bad match projection' } }; },
  }) } as unknown as SupabaseClient;
  const originalError = console.error;
  const logged: unknown[] = [];
  console.error = (...values: unknown[]) => { logged.push(values); };
  try {
    const failure = await tryRecalculateMatch120mRatings(supabase, 'fixture');
    assert.equal(failure?.matchId, 'fixture');
    assert.match(failure?.error || '', /120mRt calculation failed/);
    assert.equal(logged.length, 1);
  } finally {
    console.error = originalError;
  }
});
