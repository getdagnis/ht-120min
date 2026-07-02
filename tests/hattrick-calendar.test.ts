import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCalendarSlots,
  getHattrickCalendarContext,
  getHattrickWeekDetails,
  getHattrickWeekFromDate,
  getHattrickWeekStartDate,
  getScheduledDateForSlot,
  isBlockedCupWeek,
  getWeekendKickoffTime,
  getSignedDaysUntil,
  getDaysUntil,
} from '../src/utils/hattrick-calendar';

function assertWeek(isoDate: string, expected: { htSeason: number; htWeek: number; ht120minSeason: number }) {
  const week = getHattrickWeekFromDate(new Date(isoDate));
  assert.deepEqual(week, expected);
}

test('canonical HT dates map to the approved epoch and season progression', () => {
  assertWeek('2026-03-30T00:00:00Z', { htSeason: 94, htWeek: 1, ht120minSeason: 1 });
  assertWeek('2026-06-29T00:00:00Z', { htSeason: 94, htWeek: 14, ht120minSeason: 1 });
  assertWeek('2026-07-06T00:00:00Z', { htSeason: 94, htWeek: 15, ht120minSeason: 1 });
  assertWeek('2026-07-13T00:00:00Z', { htSeason: 94, htWeek: 16, ht120minSeason: 1 });
  assertWeek('2026-07-20T00:00:00Z', { htSeason: 95, htWeek: 1, ht120minSeason: 2 });

  assert.equal(getHattrickWeekStartDate(94, 1).toISOString(), '2026-03-29T22:00:00.000Z');
  assert.equal(getHattrickWeekStartDate(95, 1).toISOString(), '2026-07-19T22:00:00.000Z');

  const context = getHattrickCalendarContext(new Date('2026-03-30T12:00:00Z'));
  assert.equal(context.htSeason, 94);
  assert.equal(context.htWeek, 1);
  assert.equal(context.ht120minSeason, 1);
});

test('DST transitions do not change local week arithmetic', () => {
  const beforeFallback = getHattrickWeekFromDate(new Date('2026-10-25T00:30:00Z'));
  const afterFallback = getHattrickWeekFromDate(new Date('2026-10-25T04:30:00Z'));

  assert.deepEqual(beforeFallback, { htSeason: 95, htWeek: 14, ht120minSeason: 2 });
  assert.deepEqual(afterFallback, { htSeason: 95, htWeek: 14, ht120minSeason: 2 });

  const details = getHattrickWeekDetails(new Date('2026-10-25T04:30:00Z'));
  assert.equal(details.weekStart.toISOString(), '2026-10-18T22:00:00.000Z');
});

test('signed day differences keep past slots distinguishable from display values', () => {
  const now = new Date('2026-07-02T10:00:00Z');
  const yesterday = new Date('2026-07-01T10:00:00Z');
  const today = new Date('2026-07-02T05:00:00Z');
  const tomorrow = new Date('2026-07-03T05:00:00Z');

  assert.equal(getSignedDaysUntil(yesterday, now), -1);
  assert.equal(getSignedDaysUntil(today, now), 0);
  assert.equal(getSignedDaysUntil(tomorrow, now), 1);
  assert.equal(getDaysUntil(yesterday, now), 0);
});

test('cup weeks distinguish blocked W1-W3 from selectable W4-W6 warnings', () => {
  const slots = buildCalendarSlots(new Date('2026-03-30T00:00:00Z'), 6);
  const blockedWeeks = slots.filter((slot) => slot.kind === 'blocked_cup_week');
  const warnedWeeks = slots.filter((slot) => slot.htWeek >= 4 && slot.htWeek <= 6);

  assert.equal(blockedWeeks.length, 3);
  assert.equal(isBlockedCupWeek(1), true);
  assert.equal(isBlockedCupWeek(2), true);
  assert.equal(isBlockedCupWeek(3), true);
  assert.equal(isBlockedCupWeek(4), false);
  assert.equal(isBlockedCupWeek(5), false);
  assert.equal(slots.some((slot) => slot.htWeek === 16 && slot.kind === 'weekend_friendly'), false);

  for (const slot of blockedWeeks) {
    assert.equal(slot.selectable, false);
    assert.match(slot.blockedReason || '', /Cup week W[1-3] is blocked/);
  }

  assert.equal(warnedWeeks[0]?.warning, 'Cup ~60% globally');
  assert.equal(warnedWeeks[1]?.warning, 'Cup ~30% globally');
  assert.equal(warnedWeeks[2]?.warning, 'Cup ~15% globally');

  for (const slot of warnedWeeks) {
    assert.equal(slot.selectable, true);
  }
});

test('week 16 exposes the default weekend friendly while week 15 does not by default', () => {
  const slots = buildCalendarSlots(new Date('2026-06-29T00:00:00Z'), 4);
  const ordered = slots
    .filter((slot) => slot.htSeason === 94 && (slot.htWeek === 15 || slot.htWeek === 16))
    .map((slot) => `${slot.htWeek}:${slot.kind}`);

  assert.deepEqual(ordered, [
    '15:midweek_friendly',
    '16:midweek_friendly',
    '16:weekend_friendly',
  ]);
});

test('week 15 weekend can be opted into before the default week 16 weekend', () => {
  const slots = buildCalendarSlots(new Date('2026-06-29T00:00:00Z'), 4, {
    includeWeek15WeekendFriendly: true,
  });
  const ordered = slots
    .filter((slot) => slot.htSeason === 94 && (slot.htWeek === 15 || slot.htWeek === 16))
    .map((slot) => `${slot.htWeek}:${slot.kind}`);

  assert.deepEqual(ordered, [
    '15:midweek_friendly',
    '15:weekend_friendly',
    '16:midweek_friendly',
    '16:weekend_friendly',
  ]);
});

test('weekend kickoff lands on the weekend and uses the canonical weekend time', () => {
  const weekendSlot = buildCalendarSlots(new Date('2026-06-29T00:00:00Z'), 4).find(
    (slot) => slot.kind === 'weekend_friendly' && slot.htWeek === 16,
  );

  assert.ok(weekendSlot);

  const scheduled = getScheduledDateForSlot(weekendSlot!, { countryName: 'Sweden', leagueLevel: 6 });
  assert.ok(scheduled);
  assert.equal(scheduled!.getUTCDay(), 0);
  assert.equal(scheduled!.toISOString(), '2026-07-19T08:00:00.000Z');
});

test('weekend kickoff lookup falls back to the broadest division band when league level is missing', () => {
  const missingSwedishLevel = getWeekendKickoffTime('Sweden', null);
  assert.ok(missingSwedishLevel);
  assert.equal(missingSwedishLevel!.day, 0);
  assert.equal(missingSwedishLevel!.time, '10:00');
  assert.equal(missingSwedishLevel!.reason, 'Missing league level; using broadest weekend division band');

  const missingGermanLevel = getWeekendKickoffTime('Germany', null);
  assert.ok(missingGermanLevel);
  assert.equal(missingGermanLevel!.day, 6);
  assert.equal(missingGermanLevel!.time, '18:00');

  const resolved = getWeekendKickoffTime('Sweden', 6);
  assert.ok(resolved);
  assert.equal(resolved!.day, 0);
  assert.equal(resolved!.time, '10:00');
});

test('weekend kickoff lookup falls back for manual teams with missing country metadata', () => {
  const resolved = getWeekendKickoffTime(null, null);

  assert.ok(resolved);
  assert.equal(resolved!.day, 0);
  assert.equal(resolved!.time, '10:00');
  assert.equal(resolved!.source, 'weekend');
});
