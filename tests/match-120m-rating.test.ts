import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchSidePerformance } from '../shared/match-events.js';
import { calculateMatch120mRating, usesMatch120mRatings } from '../shared/match-120m-rating.js';
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
  assert.deepEqual(calculateMatch120mRating(setup()), {
    score: 100, grade: 'A+', formula_version: 1, has_set_pieces_skill: true, has_specialties: true,
  });
});

test('attacking formation and tactic with a strong attack is capped near zero', () => {
  const rating = calculateMatch120mRating(setup({
    formation: '2-5-3', tacticType: 4, tacticName: 'Attack on wings',
    ratings: { ...setup().ratings, leftAttack: raw(8) },
  }));
  assert.ok(rating);
  assert.ok(rating.score <= 10);
  assert.equal(rating.grade, 'F-');
});

test('unknown optional skill is neutral and missing specialties is not a penalty', () => {
  const unknown = calculateMatch120mRating(setup({ setPiecesTaker: null, specialtyPositions: undefined }));
  const highSkill = calculateMatch120mRating(setup({ setPiecesTaker: { playerName: null, skill: 14, skillCheckedAt: null } }));
  assert.ok(unknown && highSkill);
  assert.equal(unknown.score - highSkill.score, 5);
  assert.equal(unknown.has_set_pieces_skill, false);
  assert.equal(unknown.has_specialties, false);
});

test('four Quick players and one dangerous attack sector reduce an otherwise good setup', () => {
  const defensive = setup({
    formation: '5-4-1', tacticType: 0, tacticName: 'Normal', styleOfPlay: -1000,
    setPiecesTaker: { playerName: null, skill: 6, skillCheckedAt: null },
    specialtyPositions: [{ specialtyId: 2, roleIds: [100, 101, 102, 103] }],
    ratings: {
      leftDefence: raw(10.5), centralDefence: raw(11.5), rightDefence: raw(7.25),
      leftAttack: raw(8), centralAttack: raw(2.5), rightAttack: raw(3.75), midfield: raw(3.75),
    },
  });
  assert.equal(calculateMatch120mRating(defensive)?.grade, 'C');
});

test('the other reference setups calibrate to Pillars E, Lapsus D+, and Bousignies B', () => {
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
  assert.equal(calculateMatch120mRating(pillars)?.grade, 'E');
  assert.equal(calculateMatch120mRating(lapsus)?.grade, 'D+');
  assert.equal(calculateMatch120mRating(bousignies)?.grade, 'B');
});

test('unrecognized or incomplete core data remains unscored', () => {
  assert.equal(calculateMatch120mRating(setup({ formation: 'unknown' })), null);
  assert.equal(calculateMatch120mRating(setup({ ratings: { ...setup().ratings, midfield: null } })), null);
  assert.equal(calculateMatch120mRating(setup({ tacticType: null, tacticName: null })), null);
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
