import { calculateMatchDate } from './ht-data';
import { parseStoredStockholmDate } from '../../shared/chpp-dates';

export function getMatchDateForRound(
  round: { created_at: string; round_number: number },
  match: { scheduled_for?: string | null; ht_match_id?: number | null; schedule_slot_type?: string | null },
  countryName?: string,
): Date {
  if (match.scheduled_for) {
    const storedDate = match.ht_match_id && !match.schedule_slot_type ? parseStoredStockholmDate(match.scheduled_for) : null;
    return storedDate || new Date(match.scheduled_for);
  }
  return calculateMatchDate(round.created_at, round.round_number, countryName);
}
