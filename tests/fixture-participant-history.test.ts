import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../src/i18n/messages/en.js';

// Exercise the actual fixture view and card without loading presentation styles.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.sass')) {
      return { format: 'module', source: 'export default {};', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { FixturesView } = await import('../src/components/TournamentTabs/FixturesView.js');

function renderFixture(active: boolean, side: 'home' | 'away', bye = false, isHistorical = false) {
  const participant = { name: 'Former participant', active, ht_team_id: 12345, hattrick_user_id: 99, manager_name: 'Original manager' };
  const opponent = { name: 'Original opponent', active: true, ht_team_id: 67890 };
  const match = {
    id: 'played-match', round_id: 'round-1',
    home_team_id: side === 'home' ? (bye ? null : 'former-team') : 'opponent',
    away_team_id: side === 'away' ? (bye ? null : 'former-team') : 'opponent',
    home_team: side === 'home' ? (bye ? null : participant) : opponent,
    away_team: side === 'away' ? (bye ? null : participant) : opponent,
    home_goals: 1, away_goals: 0, completed: true, went_120: true, total_minutes: 121,
    status: 'finished' as const, ht_match_id: 771865172, match_type: 5,
    chpp_match_date: '2026-10-13T19:25:00Z',
  };
  const props: React.ComponentProps<typeof FixturesView> = {
    rounds: [{ id: 'round-1', round_number: 1, created_at: '2026-10-01T00:00:00Z', matches: [match] }],
    season: 1, upcomingRoundIndex: 0, focusedRoundIndex: 0, defaultVisibleRoundsCount: 1,
    expandedRounds: { 'round-1': true }, toggleRound() {}, onExpandAllRounds() {}, onCollapseAllRounds() {},
    tournament: { id: 'cup', name: 'Cup', slug: 'cup', created_at: '2026-10-01T00:00:00Z', last_fixtures_refresh: null },
    isRefreshingFixtures: false, async handleRefreshFixtures() {}, async onRatingsChanged() {},
    copied: {}, setCopied() {}, warnings: [], liveData: {}, canJoinTournament: false,
    isConnecting: false, onJoinWithHattrick() {}, onRatingsSignIn() {}, currentHtUserId: 99, isHistorical,
  };
  return renderToStaticMarkup(React.createElement(NextIntlClientProvider, {
    locale: 'en', messages, timeZone: 'UTC',
    children: React.createElement(FixturesView, props),
  }));
}

test('leaving keeps the actual finished fixture rendering identical on either side', () => {
  for (const side of ['home', 'away'] as const) {
    for (const historical of [false, true]) {
      const before = renderFixture(true, side, false, historical);
      const after = renderFixture(false, side, false, historical);
      assert.match(after, /Former participant/);
      assert.match(after, /Original manager/);
      assert.doesNotMatch(after, />BYE</);
      assert.equal(after, before, `${side}, archived season: ${historical}`);
    }
  }
});

test('a genuinely empty fixture side still renders BYE', () => {
  assert.match(renderFixture(false, 'away', true), />BYE</);
});
