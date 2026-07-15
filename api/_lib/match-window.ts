const DAY_MS = 24 * 60 * 60 * 1000;

type ScheduleSlotType = 'midweek_friendly' | 'weekend_friendly' | 'week15_weekend_friendly' | string | null | undefined;

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function buildWeekendWindow(targetDate: Date) {
  const targetDay = targetDate.getUTCDay();
  const daysFromSaturday = (targetDay + 1) % 7;
  const saturday = addDays(startOfUtcDay(targetDate), -daysFromSaturday);

  return {
    start: saturday,
    end: addDays(saturday, 2),
  };
}

function buildMidweekWindow(targetDate: Date) {
  const targetDay = targetDate.getUTCDay();
  const daysFromTuesday = (targetDay + 5) % 7;
  const tuesday = addDays(startOfUtcDay(targetDate), -daysFromTuesday);
  const start = new Date(tuesday);
  start.setUTCHours(12, 0, 0, 0);

  const end = addDays(tuesday, 2);
  end.setUTCHours(12, 0, 0, 0);

  return { start, end };
}

export function getAcceptedFriendlyWindow(targetDate: Date, scheduleSlotType?: ScheduleSlotType) {
  const isWeekendSlot =
    typeof scheduleSlotType === 'string'
      ? scheduleSlotType.includes('weekend')
      : targetDate.getUTCDay() === 0 || targetDate.getUTCDay() === 6;

  return isWeekendSlot ? buildWeekendWindow(targetDate) : buildMidweekWindow(targetDate);
}

export function isFriendlyInsideAcceptedWindow(
  friendlyDate: Date,
  targetDate: Date,
  scheduleSlotType?: ScheduleSlotType,
) {
  const window = getAcceptedFriendlyWindow(targetDate, scheduleSlotType);
  return friendlyDate >= window.start && friendlyDate < window.end;
}
