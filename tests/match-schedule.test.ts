import assert from 'node:assert/strict';
import test from 'node:test';

import { getMatchDateForRound, hasConfirmedMatchDate } from '../src/utils/match-schedule';
import { getTournamentNextMatchDate } from '../src/utils/tournament-next-match';

test('scheduled_for takes precedence over calculated round dates', () => {
  const round = {
    created_at: '2026-01-01T00:00:00Z',
    round_number: 2,
  };

  const scheduled = getMatchDateForRound(round, { scheduled_for: '2026-01-13T12:34:00Z' }, 'Sweden');
  assert.equal(scheduled.toISOString(), '2026-01-13T12:34:00.000Z');
});

test('linked fixture scheduled_for is interpreted as Stockholm wall-clock time', () => {
  const scheduled = getMatchDateForRound(
    { created_at: '2026-01-01T00:00:00Z', round_number: 1 },
    { scheduled_for: '2026-04-28T21:00:00+00:00', ht_match_id: 766026443 },
  );
  assert.equal(scheduled.toISOString(), '2026-04-28T19:00:00.000Z');
});

test('generated fixture keeps its UTC scheduled_for after being linked', () => {
  const scheduled = getMatchDateForRound(
    { created_at: '2026-01-01T00:00:00Z', round_number: 1 },
    {
      scheduled_for: '2026-09-23T02:15:00.000Z',
      ht_match_id: 771594636,
      schedule_slot_type: 'midweek_friendly',
    },
    'Guam',
  );
  assert.equal(scheduled.toISOString(), '2026-09-23T02:15:00.000Z');
  assert.equal(hasConfirmedMatchDate({}), false);
});

test('confirmed CHPP date overrides generated UTC schedule without changing generated metadata', () => {
  const scheduled = getMatchDateForRound(
    { created_at: '2026-01-01T00:00:00Z', round_number: 1 },
    {
      scheduled_for: '2026-09-23T02:15:00.000Z',
      chpp_match_date: '2026-09-23T18:15:00.000Z',
      ht_match_id: 771594636,
      schedule_slot_type: 'midweek_friendly',
    },
    'Guam',
  );
  assert.equal(scheduled.toISOString(), '2026-09-23T18:15:00.000Z');
  assert.equal(hasConfirmedMatchDate({ chpp_match_date: '2026-09-23T18:15:00.000Z' }), true);
});

test('Home next-match selection ignores planned estimates and uses exact CHPP dates', () => {
  const nextMatch = getTournamentNextMatchDate([
    {
      id: 'r1', created_at: '2026-01-01T00:00:00Z', round_number: 1,
      matches: [
        { id: 'estimated', completed: false, status: 'arranged', home_team_id: 'h', away_team_id: 'a', scheduled_for: '2026-10-07T10:00:00Z' },
        { id: 'exact', completed: false, status: 'arranged', home_team_id: 'h', away_team_id: 'b', scheduled_for: '2026-10-07T11:00:00Z', chpp_match_date: '2026-10-07T12:00:00Z' },
      ],
    },
  ], []);
  assert.equal(nextMatch?.toISOString(), '2026-10-07T12:00:00.000Z');
});

test('falls back to calculated date when scheduled_for is missing', () => {
  const round = {
    created_at: '2026-01-01T00:00:00Z',
    round_number: 1,
  };

  const calculated = getMatchDateForRound(round, {}, 'Sweden');
  assert.equal(Number.isNaN(calculated.getTime()), false);
});
