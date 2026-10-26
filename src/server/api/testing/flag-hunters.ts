import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from '../_lib/supabase.js';
import { getManagerChppCredentials } from '../_lib/matchmaker.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { rejectIfForgeTestingUnauthorized } from './_lib/guard.js';
import { resolveFlagCountryId, type FlagHunterTeam, type FlagCollection } from '../../../../shared/flag-hunters.js';

const positiveId = (value: unknown) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export { parseFlagHunterDetails } from '../_lib/flag-collections.js';
import { parseFlagHunterDetails, persistTeamFlagSnapshot } from '../_lib/flag-collections.js';

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
    .select('id, ht_team_id, name, hattrick_user_id, manager_name, country_name, country_id, league_id, gender_id, active, reserve_active, is_placeholder')
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
      genderId: positiveId(team.gender_id), managerCountryId: managerCountries.get(positiveId(team.hattrick_user_id)) ?? null, leagueId: positiveId(team.league_id) }));
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
  // Keep successful CHPP collections in the existing manager team record so
  // schedule generation can use them independently of this browser tab.
  try {
    await persistTeamFlagSnapshot(supabase, team.managerId, team.htTeamId, {
      leagueId: details.leagueId, countryId: details.countryId,
      homeFlagLeagueIds: flags.home, awayFlagLeagueIds: flags.away,
      flagsFetchedAt: flags.fetchedAt, homeFlagsUnknown: flags.homeUnknown, awayFlagsUnknown: flags.awayUnknown,
    }, { teamId: team.htTeamId, teamName: team.name });
  } catch {
    return res.status(502).json({ error: 'Flags were retrieved but could not be saved. Retry this team.' });
  }
  return res.status(200).json({ team: { ...team, leagueId: details.leagueId, countryId: details.countryId, flagCountryId: details.flagCountryId, genderId: details.genderId }, flags });
}
