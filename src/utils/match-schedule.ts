import { calculateMatchDate } from './ht-data.js';
import { parseStoredStockholmDate } from '../../shared/chpp-dates.js';

export function getMatchDateForRound(
  round: { created_at: string; round_number: number },
  match: { scheduled_for?: string | null; chpp_match_date?: string | null; ht_match_id?: number | null; schedule_slot_type?: string | null },
  countryName?: string,
): Date {
  // Keep the planned UTC schedule intact; a separately parsed CHPP instant is
  // authoritative regardless of generated slot metadata.
  if (match.chpp_match_date) return new Date(match.chpp_match_date);
  if (match.scheduled_for) {
    const storedDate = match.ht_match_id && !match.schedule_slot_type ? parseStoredStockholmDate(match.scheduled_for) : null;
    return storedDate || new Date(match.scheduled_for);
  }
  return calculateMatchDate(round.created_at, round.round_number, countryName);
}

export function hasConfirmedMatchDate(match: { chpp_match_date?: string | null }): boolean {
  return Boolean(match.chpp_match_date && Number.isFinite(new Date(match.chpp_match_date).getTime()));
}
