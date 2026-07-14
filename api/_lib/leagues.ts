import { HATTRICK_WORLD_DETAILS } from '../../shared/worlddetails.js';

// LeagueID is the parent-league namespace. CountryID is stored on each
// world-details record and must not be inferred from this map.
export const HATTRICK_LEAGUES: Record<string, string> = Object.fromEntries(
  Object.values(HATTRICK_WORLD_DETAILS).map((league) => [String(league.leagueId), league.englishName || league.leagueName || '']),
);

export const getLeagueNameById = (id?: number | string | null): string | undefined => {
  if (id === undefined || id === null || id === '') return undefined;
  return HATTRICK_LEAGUES[String(id)];
};
