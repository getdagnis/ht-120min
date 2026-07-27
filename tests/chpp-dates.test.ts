import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChppStockholmDate, serializeStoredStockholmDate } from '../shared/chpp-dates.js';

test('parses the authoritative summer CHPP MatchDate as a Stockholm wall-clock value', () => {
  assert.equal(parseChppStockholmDate('2026-04-28 21:00:00')?.toISOString(), '2026-04-28T19:00:00.000Z');
  assert.equal(parseChppStockholmDate('2026-04-29 18:05:00')?.toISOString(), '2026-04-29T16:05:00.000Z');
});

test('serializes linked-fixture Stockholm wall-clock values without implying a UTC conversion', () => {
  assert.equal(
    serializeStoredStockholmDate('2026-04-28 21:00:00'),
    '2026-04-28T21:00:00+00:00',
  );
});
