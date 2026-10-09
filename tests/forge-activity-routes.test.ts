import assert from 'node:assert/strict';
import test from 'node:test';
import { mostViewedTournament, summarizeUniqueTournamentViews, tournamentActivityRoute } from '../src/utils/forge-activity-routes.js';

test('tournament activity combines locale and query variants under one slug', () => {
  assert.equal(tournamentActivityRoute('/en/t/small-cup?tab=fixtures'), '/t/small-cup');
  assert.equal(tournamentActivityRoute('/lv/t/small-cup/'), '/t/small-cup');
  assert.equal(tournamentActivityRoute('/t/small-cup'), '/t/small-cup');
  for (const route of ['/en', '/en/create', '/en/collection/exotic-hfi', '/en/t/small-cup/admin', '/t/']) {
    assert.equal(tournamentActivityRoute(route), null);
  }
});

test('most viewed tournament returns a route and view count for the tooltip', () => {
  assert.deepEqual(mostViewedTournament(new Map([
    ['/t/another-cup', 2], ['/t/small-cup', 5],
  ])), { route: '/t/small-cup', count: 5 });
  assert.equal(mostViewedTournament(undefined), null);
  assert.deepEqual(mostViewedTournament(new Map([['/t/small-cup', 23]]), new Map([['/t/small-cup', 12]])), {
    route: '/t/small-cup', count: 23, uniqueCount: 12,
  });
});

test('unique tournament views count distinct visitors within each chart bucket', () => {
  const event = (day: string, route: string, visitor_id: string, event_type = 'page_view') => ({
    occurred_at: `${day}T12:00:00.000Z`, route, visitor_id, event_type,
  });
  const events = [
    event('2026-10-08', '/en/t/small-cup', 'one'),
    event('2026-10-08', '/lv/t/small-cup?tab=fixtures', 'one'),
    event('2026-10-08', '/t/small-cup', 'two'),
    event('2026-10-09', '/t/small-cup', 'one'),
    event('2026-10-09', '/t/other-cup', 'three'),
    event('2026-10-09', '/t/small-cup/admin', 'four'),
    event('2026-10-09', '/t/small-cup', 'five', 'page_exit'),
  ];
  assert.deepEqual(summarizeUniqueTournamentViews(events, (day) => day), [
    { activity_date: '2026-10-08', route: '/t/small-cup', visitor_count: 2 },
    { activity_date: '2026-10-09', route: '/t/small-cup', visitor_count: 1 },
    { activity_date: '2026-10-09', route: '/t/other-cup', visitor_count: 1 },
  ]);
  assert.deepEqual(summarizeUniqueTournamentViews(events, () => '2026-10'), [
    { activity_date: '2026-10', route: '/t/small-cup', visitor_count: 2 },
    { activity_date: '2026-10', route: '/t/other-cup', visitor_count: 1 },
  ]);
});
