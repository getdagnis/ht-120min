import assert from 'node:assert/strict';
import test from 'node:test';
import { getCanonicalEventDescription } from '../shared/match-events.js';
import { getCanonicalEventDescription as serverDescription } from '../src/server/api/_lib/chpp-match-events.js';

test('browser-safe event descriptions preserve goal tooltip fallbacks', () => {
  const examples: [number, string][] = [
    [100, 'free-kick goal'], [101, 'goal through the centre'],
    [102, 'goal on the left'], [103, 'goal on the right'],
    [104, 'penalty goal'], [105, 'goal'], [107, 'long-shot goal'],
    [125, 'unpredictable own goal'], [185, 'indirect free-kick goal'],
    [201, 'chance missed through the centre'], [422, 'head injury'],
    [511, 'yellow card for cheating'], [514, 'straight red card'],
    [9999, 'structured event 9999'],
  ];
  for (const [typeId, expected] of examples) {
    assert.equal(getCanonicalEventDescription(typeId), expected);
  }
});

test('server compatibility export reuses the shared description implementation', () => {
  assert.equal(serverDescription, getCanonicalEventDescription);
});
