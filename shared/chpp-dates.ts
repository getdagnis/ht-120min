const STOCKHOLM_TIME_ZONE = 'Europe/Stockholm';

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const wallClock = Date.UTC(
    values.year,
    (values.month || 1) - 1,
    values.day || 1,
    values.hour || 0,
    values.minute || 0,
    values.second || 0,
  );
  return Math.round((wallClock - date.getTime()) / 60_000);
}

/** CHPP MatchDate is a Stockholm wall-clock value without an offset. */
export function parseChppStockholmDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;

  const wallClock = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  );
  if (!Number.isFinite(wallClock)) return null;

  let instant = new Date(wallClock);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(instant, STOCKHOLM_TIME_ZONE);
    const nextInstant = new Date(wallClock - offsetMinutes * 60_000);
    if (nextInstant.getTime() === instant.getTime()) break;
    instant = nextInstant;
  }
  return Number.isFinite(instant.getTime()) ? instant : null;
}

/** Existing linked-fixture rows store Stockholm wall-clock components in an ISO-shaped value. */
export function parseStoredStockholmDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/);
  return match ? parseChppStockholmDate(`${match[1]} ${match[2]}`) : null;
}

/**
 * Preserve the legacy linked-fixture representation explicitly.
 *
 * The existing `matches.scheduled_for` timestamptz column stores CHPP's
 * Stockholm wall-clock components with a `+00:00` suffix. This is not a UTC
 * instant; the suffix is only how the legacy value is serialized by the
 * database. Generated schedules use real UTC instants and must not use this.
 */
export function serializeStoredStockholmDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/,
  );
  return match ? `${match[1]}T${match[2]}+00:00` : null;
}
