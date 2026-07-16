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
  assert.equal(snapshot.summary.completedMatches, 2);
  assert.equal(snapshot.summary.goals, 5);
  assert.equal(snapshot.matches.length, 2);
  assert.equal(snapshot.records.highestScoringMatchId, 'a-b');
  assert.equal(snapshot.records.longestMatchId, 'a-b');
  assert.match(snapshot.story, /Team A finished ahead of Team B/);
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
