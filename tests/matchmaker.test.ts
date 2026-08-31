import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceMatchmakerDeckCursor,
  getMatchmakerBrowseAction,
  getMatchmakerDeckView,
  getMatchmakerRequestFormState,
  getMatchmakerSwipePreviewOffset,
  normalizeMatchmakerDeckCursor,
  resolveMatchmakerSwipe,
  shouldAdvanceMatchmakerDeckAfterAction,
  upsertMockMatchmakerRequest,
  type MatchmakerRequest,
} from '../src/utils/matchmaker';

test('horizontal Matchmaker swipes resolve to their card actions', () => {
  assert.equal(resolveMatchmakerSwipe(-80, 8), 'next');
  assert.equal(resolveMatchmakerSwipe(80, -8), 'challenge');
});

test('short or primarily vertical Matchmaker gestures do not trigger actions', () => {
  assert.equal(resolveMatchmakerSwipe(-40, 2), null);
  assert.equal(resolveMatchmakerSwipe(70, 65), null);
  assert.equal(resolveMatchmakerSwipe(10, 90), null);
});

test('swipe preview uses the same activation boundary as release', () => {
  assert.equal(getMatchmakerSwipePreviewOffset(-40, 2), 0);
  assert.equal(getMatchmakerSwipePreviewOffset(70, 65), 0);
  assert.equal(getMatchmakerSwipePreviewOffset(-80, 8), -80);
  assert.equal(getMatchmakerSwipePreviewOffset(220, 8), 160);
});

test('Matchmaker deck exposes an explicit exhausted state', () => {
  assert.deepEqual(getMatchmakerDeckView([], 0), { status: 'exhausted', index: 0 });
  assert.deepEqual(getMatchmakerDeckView(['a', 'b'], 0), { status: 'card', index: 0, item: 'a' });
  assert.deepEqual(getMatchmakerDeckView(['a', 'b'], 1), { status: 'card', index: 1, item: 'b' });
  assert.deepEqual(getMatchmakerDeckView(['a', 'b'], 2), { status: 'exhausted', index: 2 });
});

test('advancing the final Matchmaker card reaches the terminal cursor', () => {
  assert.equal(advanceMatchmakerDeckCursor(0, 1), 1);
  assert.equal(normalizeMatchmakerDeckCursor(8, 2), 2);
  assert.equal(normalizeMatchmakerDeckCursor(-2, 2), 0);
});

test('successful actions only advance the same currently presented request', () => {
  assert.equal(shouldAdvanceMatchmakerDeckAfterAction('ad-1', 'ad-1'), true);
  assert.equal(shouldAdvanceMatchmakerDeckAfterAction('ad-2', 'ad-1'), false);
  assert.equal(shouldAdvanceMatchmakerDeckAfterAction(undefined, 'ad-1'), false);
});

const makeRequest = (overrides: Partial<MatchmakerRequest> = {}): MatchmakerRequest => ({
  id: 'ad-1',
  team_id: 'team-row-1',
  manager_ht_id: 1,
  match_type: '120min',
  opponent_location: 'any',
  home_away: 'any',
  match_day: 'Wednesday',
  time_window: null,
  message: null,
  status: 'open',
  matched_with_team_id: null,
  matched_at: null,
  expires_at: '2026-09-01T00:00:00.000Z',
  created_at: '2026-08-31T00:00:00.000Z',
  is_back_and_forth: false,
  is_long_term: false,
  gender_id: 1,
  team: {
    name: 'Test Team',
    ht_team_id: 123,
    logo_url: null,
    country_name: 'Latvia',
    league_id: 53,
    gender_id: 1,
    fanclub_size: null,
    arena_id: null,
    arena_size: null,
    arena_image_url: null,
    availabilityStatus: 'available',
  },
  ...overrides,
});

test('available HFI ads challenge while booked HFI and long-term ads show interest', () => {
  assert.equal(getMatchmakerBrowseAction('browse', makeRequest()), 'challenge');
  assert.equal(getMatchmakerBrowseAction('hfi', makeRequest()), 'challenge');
  assert.equal(
    getMatchmakerBrowseAction(
      'hfi',
      makeRequest({ team: { ...makeRequest().team!, availabilityStatus: 'booked' } }),
    ),
    'interest',
  );
  assert.equal(getMatchmakerBrowseAction('long-term', makeRequest()), 'interest');
});

test('editing hydrates all Matchmaker request fields and new ads reset defaults', () => {
  const request = makeRequest({
    match_type: '90min_acceptable',
    opponent_location: 'international_only',
    home_away: 'away',
    message: 'Training keepers.',
    is_back_and_forth: true,
    is_long_term: true,
  });

  assert.deepEqual(getMatchmakerRequestFormState(request), {
    selectedHtTeamId: 123,
    matchType: '90min_acceptable',
    location: 'international_only',
    homeAway: 'away',
    message: 'Training keepers.',
    isBackAndForth: true,
    isLongTerm: true,
  });
  assert.deepEqual(getMatchmakerRequestFormState(null, 321), {
    selectedHtTeamId: 321,
    matchType: '120min',
    location: 'any',
    homeAway: 'any',
    message: '',
    isBackAndForth: false,
    isLongTerm: false,
  });
});

test('mock edits replace an ad while mock creates prepend one', () => {
  const original = makeRequest();
  const edited = makeRequest({ message: 'Updated' });
  const created = makeRequest({ id: 'ad-2' });

  assert.deepEqual(upsertMockMatchmakerRequest([original], edited, original.id), [edited]);
  assert.deepEqual(upsertMockMatchmakerRequest([original], created), [created, original]);
});
