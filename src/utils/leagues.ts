import { HATTRICK_WORLD_DETAILS } from '../../shared/worlddetails';

// Parent leagues come from CHPP worldDetails. CountryID is kept separately in
// each record and must never be inferred from this LeagueID-keyed catalogue.
export const HATTRICK_LEAGUES: Record<string, string> = Object.fromEntries(
  Object.values(HATTRICK_WORLD_DETAILS).map((league) => [String(league.leagueId), league.englishName || league.leagueName || '']),
);

export const LEAGUE_NAMES = Object.values(HATTRICK_LEAGUES);

export const getLeagueIdByName = (name: string): string | undefined => {
  const normalized = String(name);
  if (normalized in HATTRICK_LEAGUES) return normalized;
  return Object.keys(HATTRICK_LEAGUES).find((key) => HATTRICK_LEAGUES[key] === name);
};

export const getLeagueNameById = (id?: number | string | null): string | undefined => {
  if (id === undefined || id === null || id === '') return undefined;
  return HATTRICK_LEAGUES[String(id)];
};

export const normalizeLeagueLimit = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (!raw) return null;
  if (raw in HATTRICK_LEAGUES) return raw;

  const matchedId = Object.entries(HATTRICK_LEAGUES).find(([, leagueName]) => leagueName === raw)?.[0];
  return matchedId ?? raw;
};
