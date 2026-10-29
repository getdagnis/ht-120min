import { parseChppStockholmDate } from '../../../../shared/chpp-dates.js';

export const AUTO_BOOKING_RETRY_MS = 5 * 60 * 1000;
export const AUTO_BOOKING_SLOW_CHECK_MS = 2 * 60 * 60 * 1000;
export const AUTO_BOOKING_PERSISTENT_BLOCK_MS = 12 * 60 * 60 * 1000;
export const AUTO_BOOKING_TRANSIENT_ERROR_MS = 30 * 60 * 1000;

export type BookingScheduleFixture = {
  scheduled_for: string | null;
  schedule_slot_type: string | null;
  home_country_id: number | null;
  away_country_id: number | null;
};

const dayMs = 24 * 60 * 60 * 1000;
const stockholm = 'Europe/Stockholm';

function stockholmDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: stockholm,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function stockholmWallClock(date: Date, hour: number) {
  const { year, month, day } = stockholmDateParts(date);
  return parseChppStockholmDate(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00:00`,
  );
}

function isInternationalMidweekFixture(fixture: BookingScheduleFixture) {
  return fixture.schedule_slot_type === 'midweek_friendly'
    && fixture.home_country_id !== null
    && fixture.away_country_id !== null
    && fixture.home_country_id !== fixture.away_country_id;
}

export function internationalBookingOpensAt(fixture: BookingScheduleFixture) {
  if (!isInternationalMidweekFixture(fixture) || !fixture.scheduled_for) return null;
  const kickoff = new Date(fixture.scheduled_for);
  if (!Number.isFinite(kickoff.getTime())) return null;

  const { year, month, day } = stockholmDateParts(kickoff);
  const localDate = Date.UTC(year, month - 1, day);
  const weekday = new Date(localDate).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const previousThursday = new Date(localDate - (daysSinceMonday + 4) * dayMs);
  return stockholmWallClock(previousThursday, 6);
}

export function firstInternationalPrecheckAt(fixture: BookingScheduleFixture) {
  const opensAt = internationalBookingOpensAt(fixture);
  if (!opensAt) return null;
  const wednesday = new Date(opensAt.getTime() - dayMs);
  return stockholmWallClock(wednesday, 10);
}

export function nextInternationalPrecheckAt(fixture: BookingScheduleFixture, now: Date) {
  const opensAt = internationalBookingOpensAt(fixture);
  if (!opensAt || now >= opensAt) return null;
  const wednesday = new Date(opensAt.getTime() - dayMs);
  const thursday = opensAt;
  const checks = [10, 14, 18, 20, 22].map((hour) => stockholmWallClock(wednesday, hour))
    .concat([0, 2, 4].map((hour) => stockholmWallClock(thursday, hour)))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  return checks.find((date) => date > now) || opensAt;
}

export function nextAutoBookingAttemptAt(
  fixture: BookingScheduleFixture,
  now: Date,
  outcome: 'preliminary_check' | 'no_safe_action' | 'pending' | 'error_70' | 'transient_error' | 'persistent_block' | 'no_outstanding',
) {
  if (outcome === 'no_outstanding') return new Date(now.getTime() + AUTO_BOOKING_SLOW_CHECK_MS);
  if (outcome === 'persistent_block') {
    const retryAt = new Date(now.getTime() + AUTO_BOOKING_PERSISTENT_BLOCK_MS);
    const opensAt = internationalBookingOpensAt(fixture);
    return opensAt && now < opensAt && opensAt < retryAt ? opensAt : retryAt;
  }
  if (outcome === 'pending' || outcome === 'error_70') {
    return new Date(now.getTime() + AUTO_BOOKING_RETRY_MS);
  }
  if (outcome === 'transient_error') {
    const opensAt = internationalBookingOpensAt(fixture);
    if (opensAt && now >= opensAt) return new Date(now.getTime() + AUTO_BOOKING_RETRY_MS);
    return new Date(now.getTime() + AUTO_BOOKING_TRANSIENT_ERROR_MS);
  }
  const opensAt = internationalBookingOpensAt(fixture);
  if (opensAt) {
    if (now < opensAt) return nextInternationalPrecheckAt(fixture, now) || opensAt;
    if (outcome === 'preliminary_check') return null;
  }
  return new Date(now.getTime() + AUTO_BOOKING_SLOW_CHECK_MS);
}

export function shouldWaitForInternationalBookingWindow(fixture: BookingScheduleFixture, now: Date) {
  const firstCheck = firstInternationalPrecheckAt(fixture);
  return Boolean(firstCheck && now < firstCheck);
}
