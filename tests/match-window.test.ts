import assert from 'node:assert/strict';
import test from 'node:test';
import { isFriendlyInsideAcceptedWindow } from '../api/_lib/match-window';

test('midweek fixture accepts Tuesday afternoon through Thursday morning', () => {
  const target = new Date('2026-07-08T21:30:00Z');

  assert.equal(isFriendlyInsideAcceptedWindow(new Date('2026-07-07T11:59:00Z'), target, 'midweek_friendly'), false);
  assert.equal(isFriendlyInsideAcceptedWindow(new Date('2026-07-07T12:00:00Z'), target, 'midweek_friendly'), true);
  assert.equal(isFriendlyInsideAcceptedWindow(new Date('2026-07-09T11:59:00Z'), target, 'midweek_friendly'), true);
  assert.equal(isFriendlyInsideAcceptedWindow(new Date('2026-07-09T12:00:00Z'), target, 'midweek_friendly'), false);
});

test('midweek fixture rejects the previous Sunday friendly', () => {
  const target = new Date('2026-07-08T21:30:00Z');

  assert.equal(isFriendlyInsideAcceptedWindow(new Date('2026-07-05T21:30:00Z'), target, 'midweek_friendly'), false);
});

test('weekend fixture accepts only Saturday and Sunday of that weekend', () => {
  const target = new Date('2026-07-12T21:30:00Z');

  assert.equal(isFriendlyInsideAcceptedWindow(new Date('2026-07-11T00:00:00Z'), target, 'weekend_friendly'), true);
  assert.equal(isFriendlyInsideAcceptedWindow(new Date('2026-07-12T23:59:00Z'), target, 'weekend_friendly'), true);
  assert.equal(isFriendlyInsideAcceptedWindow(new Date('2026-07-13T00:00:00Z'), target, 'weekend_friendly'), false);
  assert.equal(isFriendlyInsideAcceptedWindow(new Date('2026-07-08T21:30:00Z'), target, 'weekend_friendly'), false);
});
