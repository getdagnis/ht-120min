'use server';
import { loadRemainingTournamentSpotlights } from './spotlight.js';
export async function readRemainingTournamentSpotlights(tournamentId: string) {
  if (typeof tournamentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tournamentId)) throw new Error('Invalid tournament.');
  return loadRemainingTournamentSpotlights(tournamentId);
}
