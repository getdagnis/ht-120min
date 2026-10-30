export interface DisplayRound {
  round_number: number;
  round_source?: string | null;
  is_unscored?: boolean;
  phase?: string | null;
  reserved_slot_kind?: string | null;
  reserved_slot_date?: string | null;
  matches?: Array<{ scheduled_for?: string | null; chpp_match_date?: string | null }> | null;
}

export function getRoundCalendarDate(round: DisplayRound): number {
  const reserved = Date.parse(round.reserved_slot_date || '');
  if (Number.isFinite(reserved)) return reserved;
  const dates = (round.matches || [])
    .map(match => Date.parse(match.scheduled_for || match.chpp_match_date || ''))
    .filter(Number.isFinite);
  return dates.length ? Math.min(...dates) : NaN;
}

/** Extra rounds keep their stored number; this is their calendar position in the season. */
export function getRoundDisplayParts(round: DisplayRound, rounds: DisplayRound[]) {
  if (round.round_source !== 'organizer') return { number: round.round_number, suffix: '' };
  const date = getRoundCalendarDate(round);
  const preceding = Number.isFinite(date) ? rounds
    .filter(candidate => candidate.round_source !== 'organizer' && candidate.phase !== 'postseason'
      && Number.isFinite(getRoundCalendarDate(candidate))
      && getRoundCalendarDate(candidate) < date)
    .sort((a, b) => getRoundCalendarDate(b) - getRoundCalendarDate(a))[0] : undefined;
  if (!preceding) return { number: round.round_number, suffix: ' Extra' };
  const slot = round.reserved_slot_kind === 'weekend_friendly' ? 'Weekend' : 'Mid-week';
  return { number: preceding.round_number, suffix: ` .5 ${slot} Extra` };
}

export function getRoundDisplayLabel(round: DisplayRound, rounds: DisplayRound[]) {
  const { number, suffix } = getRoundDisplayParts(round, rounds);
  return `Round ${number}${suffix}${round.is_unscored === true ? ' · Unscored' : ''}`;
}
