import matchTimeData from './global-match-times.json';
import { getFriendlyTimeForCountry } from './ht-data';

export type CalendarSlotKind = 'midweek_friendly' | 'week15_weekend_friendly' | 'blocked_cup_week';
export type HattrickScheduleSlotKind = Exclude<CalendarSlotKind, 'blocked_cup_week'>;

export interface HattrickCalendarContext {
  htSeason: number;
  htWeek: number;
  ht120minSeason: number;
  weekStart: Date;
  currentStockholm: Date;
}

export interface CalendarSlot {
  id: string;
  kind: CalendarSlotKind;
  htSeason: number;
  htWeek: number;
  ht120minSeason: number;
  nominalDate: Date;
  selectable: boolean;
  blockedReason: string | null;
  warning: string | null;
}

export interface TeamSchedulingInfo {
  countryName?: string | null;
  leagueLevel?: number | null;
}

export interface TeamKickoffTime {
  day: number;
  time: string;
  label?: string;
  source?: 'midweek' | 'weekend';
  reason?: string | null;
}

export interface HattrickWeekContext {
  currentSeason: number;
  currentWeek: number;
  source: 'chpp' | 'fallback';
  sourceField?: string;
  checkedAt: string;
  checkedAtStockholm: string;
  fallbackUsed: boolean;
}

export interface CupWeekDecoration {
  blocked: boolean;
  label: string;
  tone: 'blocked' | 'warning' | 'safe';
}

export const HT_CALENDAR_EPOCH = {
  htSeason: 94,
  htWeek: 1,
  ht120minSeason: 1,
  localDate: '2026-03-30',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SEASON_WEEKS = 16;
const CUP_WEEK_DECORATIONS = new Map<number, CupWeekDecoration>([
  [1, { blocked: true, label: 'Cup 100% globally', tone: 'blocked' }],
  [2, { blocked: true, label: 'Cup 100% globally', tone: 'blocked' }],
  [3, { blocked: true, label: 'Cup 100% globally', tone: 'blocked' }],
  [4, { blocked: false, label: 'Cup ~60% globally', tone: 'warning' }],
  [5, { blocked: false, label: 'Cup ~30% globally', tone: 'safe' }],
  [6, { blocked: false, label: 'Cup ~15% globally', tone: 'safe' }],
]);
const STOCKHOLM_TIME_ZONE = 'Europe/Stockholm';
const DEFAULT_WEEKEND_KICKOFF: TeamKickoffTime = {
  day: 0,
  time: '10:00',
  label: 'Weekend fallback',
  source: 'weekend',
  reason: 'Missing country metadata',
};

const EPOCH_LOCAL_DATE_KEY = Date.UTC(2026, 2, 30);

function stockholmParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: STOCKHOLM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number.parseInt(part.value, 10);
  }

  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function stockholmDateKey(date: Date) {
  const { year, month, day } = stockholmParts(date);
  return Date.UTC(year, month - 1, day);
}

function dateKeyToParts(dateKey: number) {
  const date = new Date(dateKey);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addLocalDays(localDateKey: number, days: number) {
  return localDateKey + days * DAY_MS;
}

function localDateKeyToInstant(localDateKey: number, hours = 0, minutes = 0, seconds = 0) {
  const { year, month, day } = dateKeyToParts(localDateKey);
  let utcGuess = Date.UTC(year, month - 1, day, hours, minutes, seconds);

  for (let i = 0; i < 4; i += 1) {
    const offsetMinutes = getStockholmOffsetMinutes(new Date(utcGuess));
    const nextGuess = Date.UTC(year, month - 1, day, hours, minutes, seconds) - offsetMinutes * 60_000;
    if (nextGuess === utcGuess) break;
    utcGuess = nextGuess;
  }

  return new Date(utcGuess);
}

function getWeekIndexFromLocalDateKey(localDateKey: number) {
  return Math.floor((localDateKey - EPOCH_LOCAL_DATE_KEY) / WEEK_MS);
}

function getWeekFromIndex(weekIndex: number) {
  const seasonOffset = Math.floor(weekIndex / SEASON_WEEKS);
  const weekOffset = ((weekIndex % SEASON_WEEKS) + SEASON_WEEKS) % SEASON_WEEKS;
  const htSeason = HT_CALENDAR_EPOCH.htSeason + seasonOffset;
  const htWeek = weekOffset + 1;
  const ht120minSeason = htSeason - HT_CALENDAR_EPOCH.htSeason + HT_CALENDAR_EPOCH.ht120minSeason;
  return { htSeason, htWeek, ht120minSeason };
}

function getWeekStartLocalKey(htSeason: number, htWeek: number) {
  const weeksSinceEpoch = (htSeason - HT_CALENDAR_EPOCH.htSeason) * SEASON_WEEKS + (htWeek - HT_CALENDAR_EPOCH.htWeek);
  return addLocalDays(EPOCH_LOCAL_DATE_KEY, weeksSinceEpoch * 7);
}

export function isBlockedCupWeek(htWeek: number) {
  return CUP_WEEK_DECORATIONS.get(htWeek)?.blocked ?? false;
}

export function isCupLikelyWeek(htWeek: number) {
  return (CUP_WEEK_DECORATIONS.get(htWeek)?.tone ?? null) === 'warning';
}

export function getCupWeekDecoration(htWeek: number): CupWeekDecoration | null {
  return CUP_WEEK_DECORATIONS.get(htWeek) ?? null;
}

function createSlot(params: Omit<CalendarSlot, 'id'>): CalendarSlot {
  const suffix =
    params.kind === 'midweek_friendly' ? 'midweek' : params.kind === 'week15_weekend_friendly' ? 'weekend' : 'blocked';
  return {
    id: `S${params.htSeason}-W${params.htWeek}-${suffix}`,
    ...params,
  };
}

export function getStockholmWallClock(date: Date): Date {
  const { year, month, day, hour, minute, second } = stockholmParts(date);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

export function getStockholmOffsetMinutes(date: Date): number {
  return Math.round((getStockholmWallClock(date).getTime() - date.getTime()) / 60000);
}

export function getHattrickCalendarContext(now = new Date()): HattrickCalendarContext {
  const currentStockholm = getStockholmWallClock(now);
  const currentLocalDateKey = stockholmDateKey(now);
  const weekIndex = getWeekIndexFromLocalDateKey(currentLocalDateKey);
  const { htSeason, htWeek, ht120minSeason } = getWeekFromIndex(weekIndex);
  const weekStartLocalKey = addLocalDays(EPOCH_LOCAL_DATE_KEY, weekIndex * 7);

  return {
    htSeason,
    htWeek,
    ht120minSeason,
    weekStart: localDateKeyToInstant(weekStartLocalKey),
    currentStockholm,
  };
}

export function getHattrickWeekStartDate(htSeason: number, htWeek: number): Date {
  return localDateKeyToInstant(getWeekStartLocalKey(htSeason, htWeek));
}

export function getHattrickWeekFromDate(date: Date) {
  return getWeekFromIndex(getWeekIndexFromLocalDateKey(stockholmDateKey(date)));
}

export function getHattrickWeekDetails(date: Date) {
  const localDateKey = stockholmDateKey(date);
  const weekIndex = getWeekIndexFromLocalDateKey(localDateKey);
  const weekStartLocalKey = addLocalDays(EPOCH_LOCAL_DATE_KEY, weekIndex * 7);
  const week = getWeekFromIndex(weekIndex);

  return {
    ...week,
    weekStart: localDateKeyToInstant(weekStartLocalKey),
  };
}

export function buildCalendarSlots(now = new Date(), weeksAhead = 64): CalendarSlot[] {
  const currentWeekIndex = getWeekIndexFromLocalDateKey(stockholmDateKey(now));
  const slots: CalendarSlot[] = [];

  for (let offset = 0; offset < weeksAhead; offset += 1) {
    const weekIndex = currentWeekIndex + offset;
    const { htSeason, htWeek, ht120minSeason } = getWeekFromIndex(weekIndex);
    const weekStartLocalKey = addLocalDays(EPOCH_LOCAL_DATE_KEY, weekIndex * 7);
    const midweekLocalKey = addLocalDays(weekStartLocalKey, 2);
    const weekendLocalKey = addLocalDays(weekStartLocalKey, 5);

    if (isBlockedCupWeek(htWeek)) {
      const cupDecoration = getCupWeekDecoration(htWeek);
      slots.push(
        createSlot({
          kind: 'blocked_cup_week',
          htSeason,
          htWeek,
          ht120minSeason,
          nominalDate: localDateKeyToInstant(midweekLocalKey),
          selectable: false,
          blockedReason: cupDecoration
            ? `Cup week W${htWeek} is blocked: ${cupDecoration.label}`
            : `Cup week W${htWeek} is blocked`,
          warning: cupDecoration?.label ?? 'Cup week',
        }),
      );
      continue;
    }

    const cupDecoration = getCupWeekDecoration(htWeek);

    slots.push(
      createSlot({
        kind: 'midweek_friendly',
        htSeason,
        htWeek,
        ht120minSeason,
        nominalDate: localDateKeyToInstant(midweekLocalKey),
        selectable: true,
        blockedReason: null,
        warning: cupDecoration?.label ?? (htWeek === 15 ? 'Week 15 also has a weekend friendly slot' : null),
      }),
    );

    if (htWeek === 15) {
      slots.push(
        createSlot({
          kind: 'week15_weekend_friendly',
          htSeason,
          htWeek,
          ht120minSeason,
          nominalDate: localDateKeyToInstant(weekendLocalKey),
          selectable: true,
          blockedReason: null,
          warning: 'Week 15 weekend friendly',
        }),
      );
    }
  }

  return slots;
}

export function getUpcomingWednesdayStartSlots(now = new Date(), count = 12): CalendarSlot[] {
  return buildCalendarSlots(now, Math.max(count * 8, 64))
    .filter((slot) => slot.selectable)
    .slice(0, count);
}

export function getFriendlyWeekdayLabel(kind: HattrickScheduleSlotKind): string {
  return kind === 'week15_weekend_friendly' ? 'Weekend' : 'Wed';
}

export function getCalendarWeekdayLabel(kind: CalendarSlotKind): string {
  if (kind === 'blocked_cup_week') return 'Cup';
  return getFriendlyWeekdayLabel(kind);
}

function getLeagueByCountry(countryName?: string | null) {
  if (!countryName) return null;
  const normalized = countryName.trim().toLowerCase();
  return (
    matchTimeData.leagues.find(
      (item) => item.name.toLowerCase() === normalized || item.sourceName.toLowerCase() === normalized,
    ) ?? null
  );
}

function parseWeekendBand(label: string): number | null {
  if (label === 'I-V') return 5;
  if (label === 'I-VI') return 6;
  if (label === 'I-VII' || label === 'VII') return 7;
  if (label === 'I-VIII' || label === 'VIII') return 8;
  return null;
}

function isWeekendEntry(entry: { label: string }) {
  return !/cup/i.test(entry.label) && !/friendly/i.test(entry.label);
}

function parseDay(day: string): number {
  switch (day) {
    case 'Sunday':
      return 0;
    case 'Monday':
      return 1;
    case 'Tuesday':
      return 2;
    case 'Wednesday':
      return 3;
    case 'Thursday':
      return 4;
    case 'Friday':
      return 5;
    case 'Saturday':
      return 6;
    default:
      return 3;
  }
}

function getWeekStartForDate(date: Date) {
  const wallClock = getStockholmWallClock(date);
  const currentDay = wallClock.getUTCDay();
  const daysFromMonday = (currentDay + 6) % 7;
  return addLocalDays(stockholmDateKey(date), -daysFromMonday);
}

export function getWeekendKickoffTime(
  countryName?: string | null,
  leagueLevel?: number | null,
): TeamKickoffTime | null {
  const league = getLeagueByCountry(countryName);
  if (!league)
    return countryName ? { ...DEFAULT_WEEKEND_KICKOFF, reason: 'Unknown country metadata' } : DEFAULT_WEEKEND_KICKOFF;

  const weekendEntries = league.entries.filter(isWeekendEntry).map((entry) => ({
    ...entry,
    band: parseWeekendBand(entry.label),
  }));

  if (weekendEntries.length === 0) return null;

  const sortedEntries = weekendEntries
    .filter((entry) => entry.band !== null)
    .sort((a, b) => (a.band ?? 99) - (b.band ?? 99));

  if (leagueLevel == null) {
    const entry = sortedEntries[0] ?? weekendEntries[0];
    return entry
      ? {
          day: parseDay(entry.day),
          time: entry.time,
          label: entry.label,
          source: 'weekend',
          reason: 'Missing league level; using broadest weekend division band',
        }
      : null;
  }

  const levelBand = leagueLevel <= 6 ? 6 : leagueLevel === 7 ? 7 : 8;
  const chosen =
    sortedEntries.find((entry) => (entry.band ?? 99) >= levelBand) ?? sortedEntries[sortedEntries.length - 1];
  if (!chosen) return null;

  return { day: parseDay(chosen.day), time: chosen.time, label: chosen.label, source: 'weekend' };
}

export function getMidweekKickoffTime(countryName?: string | null): TeamKickoffTime | null {
  const friendly = getFriendlyTimeForCountry(countryName ?? undefined);
  return { day: friendly.day, time: friendly.time, label: 'Friendly', source: 'midweek' };
}

export function getKickoffTimeForSlot(
  kind: HattrickScheduleSlotKind,
  team: TeamSchedulingInfo,
): TeamKickoffTime | null {
  if (kind === 'midweek_friendly') {
    return getMidweekKickoffTime(team.countryName ?? null);
  }
  return getWeekendKickoffTime(team.countryName ?? null, team.leagueLevel ?? null);
}

export function getScheduledDateForBaseDate(
  baseDate: Date,
  kind: HattrickScheduleSlotKind,
  team: TeamSchedulingInfo,
): Date | null {
  const kickoffTime = getKickoffTimeForSlot(kind, team);
  if (!kickoffTime) return null;

  const weekStartLocalKey = getWeekStartForDate(baseDate);
  const kickoffOffset = (kickoffTime.day + 6) % 7;
  const targetLocalKey = addLocalDays(weekStartLocalKey, kickoffOffset);
  const [hours, minutes] = kickoffTime.time.split(':').map(Number);
  return localDateKeyToInstant(targetLocalKey, hours, minutes, 0);
}

export function getScheduledDateForSlot(slot: CalendarSlot, team: TeamSchedulingInfo): Date | null {
  if (!slot.selectable) return null;
  return getScheduledDateForBaseDate(slot.nominalDate, slot.kind as HattrickScheduleSlotKind, team);
}

export function getNearestSelectableSlot(slots: CalendarSlot[]) {
  return slots.find((slot) => slot.selectable) ?? null;
}

export function formatCalendarDate(date: Date, weekdayFormat: 'short' | 'long' = 'short') {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: STOCKHOLM_TIME_ZONE,
    weekday: weekdayFormat,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatCalendarDateWithWeek(date: Date, weekdayFormat: 'short' | 'long' = 'short') {
  const week = getHattrickWeekDetails(date);
  return `${formatCalendarDate(date, weekdayFormat)}, W${week.htWeek}`;
}

export function getDaysUntil(date: Date, now = new Date()) {
  return Math.max(0, getSignedDaysUntil(date, now));
}

export function getSignedDaysUntil(date: Date, now = new Date()) {
  const todayKey = stockholmDateKey(now);
  const targetKey = stockholmDateKey(date);
  return Math.round((targetKey - todayKey) / DAY_MS);
}

// Compatibility helpers for legacy code paths and CHPP-derived week context.
export function getHattrickNowStockholm(now = new Date()): Date {
  return getStockholmWallClock(now);
}

function readFirstMatch(xml: string, tags: string[]): string | null {
  for (const tag of tags) {
    const match = xml.match(new RegExp(`<${tag}>(\\d+)</${tag}>`, 'i'))?.[1];
    if (match) return match;
  }
  return null;
}

export function extractHattrickWeekContext(xml: string, checkedAt = new Date()): HattrickWeekContext | null {
  const seasonRaw = readFirstMatch(xml, ['CurrentSeason', 'SeasonNumber']);
  const weekRaw = readFirstMatch(xml, ['CurrentWeek', 'LeagueMatchRound']);

  if (!seasonRaw || !weekRaw) return null;

  return {
    currentSeason: Number.parseInt(seasonRaw, 10),
    currentWeek: Number.parseInt(weekRaw, 10),
    source: 'chpp',
    sourceField: `${seasonRaw ? 'season' : ''}${seasonRaw && weekRaw ? '+' : ''}${weekRaw ? 'week' : ''}` || 'unknown',
    checkedAt: checkedAt.toISOString(),
    checkedAtStockholm: getHattrickNowStockholm(checkedAt).toISOString(),
    fallbackUsed: false,
  };
}

export function getFallbackHattrickWeekContext(now = new Date()): HattrickWeekContext {
  const current = getStockholmWallClock(now);
  const { htSeason, htWeek } = getWeekFromIndex(getWeekIndexFromLocalDateKey(stockholmDateKey(now)));

  return {
    currentSeason: htSeason,
    currentWeek: htWeek,
    source: 'fallback',
    sourceField: 'calendar epoch',
    checkedAt: now.toISOString(),
    checkedAtStockholm: current.toISOString(),
    fallbackUsed: true,
  };
}

export function resolveHattrickWeekContext(xml?: string | null, now = new Date()): HattrickWeekContext {
  if (xml) {
    const parsed = extractHattrickWeekContext(xml, now);
    if (parsed) return parsed;
  }

  return getFallbackHattrickWeekContext(now);
}
