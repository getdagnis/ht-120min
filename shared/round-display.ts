export interface DisplayRound {
  round_number: number;
  round_source?: string | null;
  phase?: string | null;
  reserved_slot_kind?: string | null;
  reserved_slot_date?: string | null;
}

/** Extra rounds keep their stored number; this is their calendar position in the season. */
export function getRoundDisplayParts(round: DisplayRound, rounds: DisplayRound[]) {
  if (round.round_source !== 'organizer') return { number: round.round_number, suffix: '' };
  const date = Date.parse(round.reserved_slot_date || '');
  const preceding = Number.isFinite(date) ? rounds
    .filter(candidate => candidate.round_source !== 'organizer' && candidate.phase !== 'postseason'
      && Number.isFinite(Date.parse(candidate.reserved_slot_date || ''))
      && Date.parse(candidate.reserved_slot_date!) < date)
    .sort((a, b) => Date.parse(b.reserved_slot_date!) - Date.parse(a.reserved_slot_date!))[0] : undefined;
  if (!preceding) return { number: round.round_number, suffix: ' Extra' };
  const slot = round.reserved_slot_kind === 'weekend_friendly' ? 'Weekend' : 'Mid-week';
  return { number: preceding.round_number, suffix: ` .5 ${slot} Extra` };
}

export function getRoundDisplayLabel(round: DisplayRound, rounds: DisplayRound[]) {
  const { number, suffix } = getRoundDisplayParts(round, rounds);
  return `Round ${number}${suffix}`;
}
