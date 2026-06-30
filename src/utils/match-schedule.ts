import { calculateMatchDate } from './ht-data';

export function getMatchDateForRound(
  round: { created_at: string; round_number: number },
  match: { scheduled_for?: string | null },
  countryName?: string,
): Date {
  return match.scheduled_for ? new Date(match.scheduled_for) : calculateMatchDate(round.created_at, round.round_number, countryName);
}

