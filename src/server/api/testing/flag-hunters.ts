import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from '../_lib/supabase.js';
import { getManagerChppCredentials } from '../_lib/matchmaker.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { parseTeamDetailsXml } from '../_lib/chpp-xml.js';
import { rejectIfForgeTestingUnauthorized } from './_lib/guard.js';
import { normalizeFlagCountries, resolveFlagCountryId, type FlagHunterTeam, type FlagCollection } from '../../../../shared/flag-hunters.js';

const positiveId = (value: unknown) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** Reuse parsed LeagueIDs but do not mistake an omitted Flags element for an empty collection. */
export function parseFlagHunterDetails(xml: string, htTeamId: number) {
  if (/<ErrorCode>\s*[1-9]\d*\s*<\/ErrorCode>/i.test(xml)) throw new Error('Hattrick returned an error while retrieving flags.');
  const blocks = [...xml.matchAll(/<Team>([\s\S]*?)<\/Team>/gi)].map(match => match[1]);
  const block = blocks.find(item => Number(item.match(/<TeamID>\s*(\d+)\s*<\/TeamID>/i)?.[1]) === htTeamId);
  if (!block) throw new Error('Hattrick did not return the requested team.');
  const flags = block.match(/<Flags>([\s\S]*?)<\/Flags>/i)?.[1];
  if (flags === undefined || !/<HomeFlags(?:\s*\/\s*>|>[\s\S]*?<\/HomeFlags>)/i.test(flags)
    || !/<AwayFlags(?:\s*\/\s*>|>[\s\S]*?<\/AwayFlags>)/i.test(flags)) {
    throw new Error('Hattrick omitted the flag collections; they remain unknown.');
  }
  const parsed = parseTeamDetailsXml(xml, htTeamId);
  const leagueId = positiveId(parsed.leagueId);
  if (!leagueId) throw new Error('Hattrick omitted the team LeagueID.');
  const countryId = positiveId(parsed.countryId);
  const home = normalizeFlagCountries(parsed.homeFlagLeagueIds), away = normalizeFlagCountries(parsed.awayFlagLeagueIds);
  return { leagueId, countryId, flagCountryId: resolveFlagCountryId(countryId),
    home: home.ids, away: away.ids, homeUnknown: home.unknown, awayUnknown: away.unknown };
}

export default async function handleFlagHunters(req: VercelRequest, res: VercelResponse) {
  // Check Forge enablement here as well: the outer testing dispatcher permits an existing admin session.
  if (rejectIfForgeTestingUnauthorized(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const slug = typeof req.query.slug === 'string' ? req.query.slug.trim() : 'around-the-world';
  if (!slug || slug.length > 160) return res.status(400).json({ error: 'A valid tournament slug is required.' });
  const supabase = getServiceSupabase();
  const tournamentResult = await supabase.from('tournaments').select('id, name, slug').eq('slug', slug).maybeSingle();
  if (tournamentResult.error) throw tournamentResult.error;
  if (!tournamentResult.data) return res.status(404).json({ error: 'Tournament not found.' });
  const tournament = tournamentResult.data;
  const teamResult = await supabase.from('teams')
    .select('id, ht_team_id, name, hattrick_user_id, manager_name, country_name, country_id, league_id, active, reserve_active, is_placeholder')
    .eq('tournament_id', tournament.id).eq('active', true).order('created_at', { ascending: true });
  if (teamResult.error) throw teamResult.error;
  const managerIds = [...new Set((teamResult.data ?? []).map(team => positiveId(team.hattrick_user_id)).filter((id): id is number => id !== null))];
  const profileResult = managerIds.length ? await supabase.from('profiles').select('hattrick_user_id, country_id').in('hattrick_user_id', managerIds) : { data: [], error: null };
  if (profileResult.error) throw profileResult.error;
  const managerCountries = new Map((profileResult.data ?? []).map(profile => [positiveId(profile.hattrick_user_id), positiveId(profile.country_id)]));
  const teams: FlagHunterTeam[] = (teamResult.data ?? [])
    .filter(team => team.active === true && team.reserve_active !== true && team.is_placeholder !== true && positiveId(team.ht_team_id))
    .map(team => ({ id: team.id, htTeamId: positiveId(team.ht_team_id)!, name: team.name || 'Unnamed team',
      managerId: positiveId(team.hattrick_user_id), managerName: team.manager_name,
      countryName: team.country_name, countryId: positiveId(team.country_id),
      flagCountryId: resolveFlagCountryId(positiveId(team.country_id)),
      managerCountryId: managerCountries.get(positiveId(team.hattrick_user_id)) ?? null, leagueId: positiveId(team.league_id) }));
  if (new Set(teams.map(team => team.htTeamId)).size !== teams.length) {
    return res.status(409).json({ error: 'The admitted roster contains duplicate Hattrick team IDs. Resolve those entries before pairing.' });
  }
  if (req.method === 'GET') return res.status(200).json({ tournament, teams });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const htTeamId = positiveId(req.body?.htTeamId);
  const team = teams.find(item => item.htTeamId === htTeamId);
  if (!team || !team.managerId) return res.status(409).json({ error: 'This team is no longer admitted or has no recorded manager.' });
  const consumerKey = process.env.CHPP_CONSUMER_KEY, consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return res.status(503).json({ error: 'CHPP configuration is unavailable.' });
  const credentials = await getManagerChppCredentials(supabase, team.managerId);
  if (!credentials) return res.status(409).json({ error: 'No saved Hattrick authorization for this manager.' });
  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const params = { file: 'teamdetails', version: '3.9', teamID: String(team.htTeamId), includeFlags: 'true' };
  const response = await fetch(`${url}?${new URLSearchParams(params)}`, {
    headers: { Authorization: getAuthHeader('GET', url, params, consumerKey, consumerSecret,
      credentials.oauth_token, credentials.oauth_token_secret) }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return res.status(502).json({ error: 'Hattrick flag retrieval failed. Retry this team.' });
  const details = parseFlagHunterDetails(await response.text(), team.htTeamId);
  const flags: FlagCollection = { htTeamId: team.htTeamId, managerId: team.managerId, leagueId: details.leagueId,
    home: details.home, away: details.away, homeUnknown: details.homeUnknown, awayUnknown: details.awayUnknown, fetchedAt: new Date().toISOString() };
  // Snapshot-only response: no tournament, profile or team writes and no challenge action.
  return res.status(200).json({ team: { ...team, leagueId: details.leagueId, countryId: details.countryId, flagCountryId: details.flagCountryId }, flags });
}
