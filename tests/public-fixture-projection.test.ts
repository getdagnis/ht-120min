import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPublicFixture, projectPublicSeason } from '../src/utils/public-fixture-projection.js';

test('public projection preserves performance and statistics without mutating report inputs', () => {
  const events = { version: 3, source: 'matchdetails-3.1', home: { injuries: [{ weeks: 3 }], cards: [], goals: [], performance: { ratings: { midfield: 12 } } }, away: { injuries: [], cards: [] }, result: { goals: 2 }, notableEvents: [{ text: 'report' }] };
  const match = { completed: true, match_event_details: events, next_match_arrange_story: ['saved'], home_goals: 2 };
  const projected = projectPublicFixture(match);
  assert.equal('result' in projected.match_event_details, false);
  assert.equal('next_match_arrange_story' in projected, false);
  assert.deepEqual(projected.match_event_details.home, events.home);
  assert.ok(match.match_event_details.result);
  assert.deepEqual(match.next_match_arrange_story, ['saved']);
  assert.equal(projectPublicFixture({ ...match, completed: false }).match_event_details, null);
  const summary = { standings: [{ teamId: 'a' }], teamStats: [{ injuries: 3 }], matches: [{ injuries: 3, went120: true }] };
  const history = projectPublicSeason({ snapshot_json: summary, fixtures_snapshot_json: { rounds: [{ matches: [match] }] } });
  assert.deepEqual(history.snapshot_json, summary);
  assert.equal('result' in history.fixtures_snapshot_json.rounds[0].matches[0].match_event_details, false);
});
