import { teamDetailsKitForMatchSide, type ParsedTeamDetails } from './chpp-xml.js';
import { fetchTeamDetailsFromChpp } from './matchmaker.js';

type Credentials = { oauth_token: string; oauth_token_secret: string };
type KitCache = Map<number, Promise<ParsedTeamDetails | null>>;

export async function fetchFixtureHomeAwayKits(input: {
  consumerKey: string;
  consumerSecret: string;
  credentials: Credentials;
  actualHomeTeamId: number | null;
  actualAwayTeamId: number | null;
  homeTeamIds: Array<number | null>;
  awayTeamIds: Array<number | null>;
  cache?: KitCache;
}): Promise<{ home_match_kit_url: string | null; away_match_kit_url: string | null }> {
  const getDetails = (ids: Array<number | null>) => {
    const teamId = ids.find((id) => id && (id === input.actualHomeTeamId || id === input.actualAwayTeamId));
    if (!teamId) return Promise.resolve(null);
    const cached = input.cache?.get(teamId);
    if (cached) return cached;
    const request = fetchTeamDetailsFromChpp(input.consumerKey, input.consumerSecret, input.credentials, teamId)
      .catch(() => null);
    input.cache?.set(teamId, request);
    return request;
  };
  const [home, away] = await Promise.all([getDetails(input.homeTeamIds), getDetails(input.awayTeamIds)]);
  return {
    home_match_kit_url: teamDetailsKitForMatchSide(home, input.actualHomeTeamId, input.actualAwayTeamId),
    away_match_kit_url: teamDetailsKitForMatchSide(away, input.actualHomeTeamId, input.actualAwayTeamId),
  };
}
