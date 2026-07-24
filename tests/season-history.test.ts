import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeasonHistorySnapshot,
  normalizeSeasonHistorySnapshot,
  resolveSeasonFinishedAt,
  resolveSeasonStartedAt,
  type SeasonHistorySnapshotV1,
} from '../src/utils/season-history';
import type { Team } from '../src/utils/standings';

const teams: Team[] = [
  {
    id: 'a',
    name: 'Team A',
    ht_team_id: 101,
    hattrick_user_id: 1001,
    active: true,
    replacement_for_team_id: null,
    logo_url: '/a.png',
    manager_name: 'Manager A',
  },
  {
    id: 'b',
    name: 'Team B',
    ht_team_id: 102,
    hattrick_user_id: 1002,
    active: true,
    replacement_for_team_id: null,
  },
  {
    id: 'c',
    name: 'Team C',
    ht_team_id: 103,
    hattrick_user_id: 1003,
    active: false,
    replacement_for_team_id: null,
  },
  {
    id: 'placeholder',
    name: 'BYE',
    ht_team_id: null,
    hattrick_user_id: null,
    active: true,
    replacement_for_team_id: null,
    is_placeholder: true,
  },
];
const teamD: Team = {
  id: 'd',
  name: 'Team D',
  ht_team_id: 104,
  hattrick_user_id: 1004,
  active: true,
  replacement_for_team_id: null,
};

test('season snapshot freezes participants, shares tied awards, and excludes incomplete fixture awards', () => {
  const snapshot = buildSeasonHistorySnapshot(
    teams,
    [
      {
        id: 'a-b',
        roundNumber: 1,
        home_team_id: 'a',
        away_team_id: 'b',
        home_goals: 2,
        away_goals: 1,
        completed: true,
        went_120: true,
        total_minutes: 120,
        home_yellow_cards: 2,
      },
      {
        id: 'a-c',
        roundNumber: 2,
        home_team_id: 'a',
        away_team_id: 'c',
        home_goals: null,
        away_goals: null,
        completed: false,
        went_120: false,
        total_minutes: 90,
      },
      {
        id: 'b-c',
        roundNumber: 2,
        home_team_id: 'b',
        away_team_id: 'c',
        home_goals: 1,
        away_goals: 1,
        completed: true,
        went_120: false,
        total_minutes: 90,
        away_injuries: 1,
      },
    ],
    '120min',
  );

  assert.equal(snapshot.version, 2);
  assert.deepEqual(
    snapshot.participants.map((participant) => participant.teamId).sort(),
    ['a', 'b', 'c'],
  );
  assert.equal(snapshot.participants.find((participant) => participant.teamId === 'a')?.logoUrl, '/a.png');
  assert.deepEqual(
    snapshot.awards.find((award) => award.key === 'top-scorers')?.recipientTeamIds.sort(),
    ['a', 'b'],
  );
  assert.deepEqual(snapshot.awards.find((award) => award.key === 'most-120-matches')?.recipientTeamIds, ['a', 'b']);
  assert.deepEqual(
    snapshot.awards.find((award) => award.key === 'fair-play')?.recipientTeamIds.sort(),
    ['b', 'c'],
  );
  assert.deepEqual(
    snapshot.awards.find((award) => award.key === 'every-fixture-completed')?.recipientTeamIds,
    ['b'],
  );
  assert.deepEqual(
    snapshot.awards.find((award) => award.key === 'total-minute-specialists')?.recipientTeamIds,
    ['b'],
  );
  assert.deepEqual(
    snapshot.awards.find((award) => award.key === 'least-goals-allowed')?.recipientTeamIds.sort(),
    ['a', 'c'],
  );
  assert.deepEqual(snapshot.awards.find((award) => award.key === 'most-cards')?.recipientTeamIds, ['a']);
  assert.equal(snapshot.awards.find((award) => award.key === 'most-cards')?.value, 2);
  assert.deepEqual(snapshot.awards.find((award) => award.key === 'most-injuries')?.recipientTeamIds, ['c']);
  assert.equal(snapshot.awards.find((award) => award.key === 'most-injuries')?.value, 1);
  assert.equal(snapshot.summary.completedMatches, 2);
  assert.equal(snapshot.summary.goals, 5);
  assert.equal(snapshot.matches.length, 2);
  assert.equal(snapshot.records.highestScoringMatchId, 'a-b');
  assert.equal(snapshot.records.longestMatchId, 'a-b');
  assert.match(snapshot.story, /Team A finished ahead of Team B in a season with 1 match reaching 120 minutes out of 2 total/);
});

test('points snapshots calculate closest finish from points', () => {
  const snapshot = buildSeasonHistorySnapshot(
    teams.slice(0, 2),
    [
      {
        id: 'draw',
        home_team_id: 'a',
        away_team_id: 'b',
        home_goals: 2,
        away_goals: 2,
        completed: true,
        went_120: false,
        total_minutes: 90,
      },
    ],
    'points',
  );

  assert.equal(snapshot.records.closestFinish?.metric, 'points');
  assert.equal(snapshot.records.closestFinish?.margin, 0);
});

test('zero-match teams cannot win low-total awards, including APPG fair play', () => {
  const snapshot = buildSeasonHistorySnapshot(
    teams,
    [
      {
        id: 'played',
        home_team_id: 'a',
        away_team_id: 'b',
        home_goals: 1,
        away_goals: 0,
        completed: true,
        went_120: false,
        total_minutes: 90,
        home_yellow_cards: 1,
      },
    ],
    'appg',
  );

  assert.equal(snapshot.awards.find((award) => award.key === 'least-goals-allowed')?.recipientTeamIds.includes('c'), false);
  assert.equal(snapshot.awards.find((award) => award.key === 'fair-play')?.recipientTeamIds.includes('c'), false);
  assert.deepEqual(snapshot.awards.find((award) => award.key === 'most-matches-played')?.recipientTeamIds.sort(), ['a', 'b']);
  assert.equal(snapshot.awards.some((award) => award.key === 'every-fixture-completed'), false);
});

test('APPG low-total awards require at least half the maximum completed matches, rounded up', () => {
  const snapshot = buildSeasonHistorySnapshot(
    [...teams, teamD],
    [
      { id: 'a1', home_team_id: 'b', away_team_id: 'a', home_goals: 1, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'a2', home_team_id: 'b', away_team_id: 'a', home_goals: 1, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'a3', home_team_id: 'b', away_team_id: 'a', home_goals: 1, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'a4', home_team_id: 'b', away_team_id: 'a', home_goals: 1, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'c1', home_team_id: 'c', away_team_id: 'd', home_goals: 0, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'c2', home_team_id: 'c', away_team_id: 'd', home_goals: 0, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
    ],
    'appg',
  );

  assert.equal(snapshot.awards.find((award) => award.key === 'least-goals-allowed')?.recipientTeamIds.includes('c'), true);
  assert.equal(snapshot.awards.find((award) => award.key === 'least-goals-allowed')?.recipientTeamIds.includes('d'), true);
  assert.deepEqual(snapshot.awards.find((award) => award.key === 'most-matches-played')?.recipientTeamIds.sort(), ['a', 'b']);
});

test('APPG eligibility excludes teams below half and shares most-matches ties', () => {
  const snapshot = buildSeasonHistorySnapshot(
    [...teams, teamD],
    [
      { id: 'a1', home_team_id: 'a', away_team_id: 'b', home_goals: 1, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'a2', home_team_id: 'a', away_team_id: 'b', home_goals: 1, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'a3', home_team_id: 'a', away_team_id: 'b', home_goals: 1, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'a4', home_team_id: 'a', away_team_id: 'b', home_goals: 1, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'a5', home_team_id: 'a', away_team_id: 'b', home_goals: 1, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
      { id: 'c1', home_team_id: 'c', away_team_id: 'd', home_goals: 0, away_goals: 0, completed: true, went_120: false, total_minutes: 90 },
    ],
    'appg',
  );

  assert.equal(snapshot.awards.find((award) => award.key === 'least-goals-allowed')?.recipientTeamIds.includes('c'), false);
  assert.deepEqual(snapshot.awards.find((award) => award.key === 'most-matches-played')?.recipientTeamIds.sort(), ['a', 'b']);
});

test('APPG produces no match-count or low-total awards when no match is completed', () => {
  const snapshot = buildSeasonHistorySnapshot(teams.slice(0, 3), [], 'appg');

  assert.equal(snapshot.awards.some((award) => award.key === 'most-matches-played'), false);
  assert.equal(snapshot.awards.some((award) => award.key === 'least-goals-allowed'), false);
  assert.equal(snapshot.awards.some((award) => award.key === 'fair-play'), false);
  assert.equal(snapshot.awards.some((award) => award.key === 'every-fixture-completed'), false);
});

test('most injuries is decided by injury weeks while preserving injury counts', () => {
  const snapshot = buildSeasonHistorySnapshot(
    teams.slice(0, 2),
    [
      {
        id: 'injured',
        home_team_id: 'a',
        away_team_id: 'b',
        home_goals: 1,
        away_goals: 0,
        completed: true,
        went_120: false,
        total_minutes: 90,
        home_injuries: 1,
        away_injuries: 2,
        match_event_details: {
          version: 1,
          source: 'matchdetails-3.1',
          actualHomeTeamId: 101,
          actualAwayTeamId: 102,
          home: {
            teamId: 101,
            cards: [],
            injuries: [{ playerId: 1, minute: 10, matchPart: 1, injuryType: 2, severity: 'injury', locationEventTypeId: null, weeks: 8, causedByFoul: false, causedByTeamId: null }],
          },
          away: {
            teamId: 102,
            cards: [],
            injuries: [
              { playerId: 2, minute: 20, matchPart: 1, injuryType: 2, severity: 'injury', locationEventTypeId: null, weeks: 2, causedByFoul: false, causedByTeamId: null },
              { playerId: 3, minute: 30, matchPart: 1, injuryType: 2, severity: 'injury', locationEventTypeId: null, weeks: 2, causedByFoul: false, causedByTeamId: null },
            ],
          },
        },
      },
    ],
    'appg',
  );

  const award = snapshot.awards.find((item) => item.key === 'most-injuries');
  assert.deepEqual(award?.recipientTeamIds, ['a']);
  assert.equal(award?.recipientValues?.a, 1);
  assert.equal(award?.recipientSecondaryValues?.a, 8);
});

test('legacy snapshots remain readable without inventing fixture-completion awards', () => {
  const current = buildSeasonHistorySnapshot(teams.slice(0, 2), [], '120min');
  const legacy: SeasonHistorySnapshotV1 = {
    standings: current.standings,
    winner: current.winner,
    teamStats: current.teamStats,
    summary: current.summary,
    generatedAt: current.generatedAt,
  };
  const normalized = normalizeSeasonHistorySnapshot(legacy);

  assert.equal(normalized.version, 2);
  assert.equal(normalized.participants.length, 2);
  assert.equal(normalized.matches.length, 0);
  assert.equal(normalized.awards.some((award) => award.key === 'every-fixture-completed'), false);
});

test('season finish date uses the latest completed fixture and ignores unfinished or invalid dates', () => {
  const fallback = '2026-07-16T12:00:00.000Z';
  const finishedAt = resolveSeasonFinishedAt(
    [
      {
        home_team_id: 'a',
        away_team_id: 'b',
        home_goals: 1,
        away_goals: 0,
        completed: true,
        went_120: false,
        scheduledFor: '2026-06-01T20:00:00.000Z',
      },
      {
        home_team_id: 'a',
        away_team_id: 'b',
        home_goals: 2,
        away_goals: 1,
        completed: true,
        went_120: true,
        scheduledFor: '2026-06-08T20:00:00.000Z',
      },
      {
        home_team_id: 'a',
        away_team_id: 'b',
        home_goals: null,
        away_goals: null,
        completed: false,
        went_120: false,
        scheduledFor: '2026-06-15T20:00:00.000Z',
      },
    ],
    fallback,
  );

  assert.equal(finishedAt, '2026-06-08T20:00:00.000Z');
  assert.equal(resolveSeasonFinishedAt([], fallback), fallback);
  assert.equal(
    resolveSeasonStartedAt(
      [
        {
          home_team_id: 'a',
          away_team_id: 'b',
          home_goals: 1,
          away_goals: 0,
          completed: true,
          went_120: false,
          scheduledFor: '2026-06-08T20:00:00.000Z',
        },
        {
          home_team_id: 'a',
          away_team_id: 'b',
          home_goals: 2,
          away_goals: 0,
          completed: true,
          went_120: false,
          scheduledFor: '2026-06-01T20:00:00.000Z',
        },
      ],
      null,
    ),
    '2026-06-01T20:00:00.000Z',
  );
});
