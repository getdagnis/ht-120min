import { parseChppStockholmDate } from '../../../../shared/chpp-dates.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getForgeSuperadminId } from '../_lib/forge-session.js';
import { getServiceSupabase } from '../_lib/supabase.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import { getManagerChppCredentials } from '../_lib/matchmaker.js';
import { parseMatchesXml, readChppTag } from '../_lib/chpp-xml.js';
import { rejectIfForgeTestingUnauthorized } from './_lib/guard.js';
import { parseLeagueAvailability, parseLeagueSeries, parseLeagueTeam, parseSeriesHumanTeams, parseSmallLeagues, xmlBlocks } from './_lib/league-xml.js';
import { FORGE_LEAGUE_TEAM_LIMIT } from '../../../utils/forge-leagues.js';
import type { ForgeLeagueOption, ForgeLeagueSnapshot, ForgeLeagueTeam } from '../../../utils/forge-leagues.js';

const TABLE = 'forge_league_snapshots';
const OUTREACH_CAMPAIGNS = 'forge_league_outreach_campaigns';
const OUTREACH_CONTACTS = 'forge_league_outreach_contacts';
const BATCH_SIZE = 3;
type Credentials = NonNullable<Awaited<ReturnType<typeof getManagerChppCredentials>>>;
let credentialCache: { managerId: number; credentials: Credentials; expires: number } | null = null;
let catalogueCache: { leagues: ForgeLeagueOption[]; expires: number; checkedAt: string } | null = null;

async function scanner() {
  const managerId = getForgeSuperadminId();
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!managerId || !consumerKey || !consumerSecret) throw new Error('League scanner configuration is missing.');
  if (!credentialCache || credentialCache.managerId !== managerId || credentialCache.expires <= Date.now()) {
    const credentials = await getManagerChppCredentials(getServiceSupabase(), managerId);
    if (!credentials) throw new Error('The league scanner needs stored CHPP access.');
    credentialCache = { managerId, credentials, expires: Date.now() + 5 * 60 * 1000 };
  }
  const credentials = credentialCache.credentials;
  return {
    async xml(file: string, version: string, extra: Record<string, string> = {}) {
      const params = { file, version, ...extra };
      const url = 'https://chpp.hattrick.org/chppxml.ashx';
      const response = await fetch(`${url}?${new URLSearchParams(params)}`, {
        headers: { Authorization: getAuthHeader('GET', url, params, consumerKey, consumerSecret, credentials.oauth_token, credentials.oauth_token_secret) },
        cache: 'no-store', signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) credentialCache = null;
        throw new Error(`CHPP ${file} failed (${response.status}).`);
      }
      const xml = await response.text();
      if (xml.length > 4 * 1024 * 1024 || !/<HattrickData[\s>]/i.test(xml)) throw new Error(`CHPP ${file} returned an invalid response.`);
      const error = Number(readChppTag(xml, 'ErrorCode') || '0');
      if (error) throw new Error(`CHPP ${file} returned error ${error}.`);
      return xml;
    },
  };
}

async function catalogue() {
  if (!catalogueCache || catalogueCache.expires <= Date.now()) {
    const source = await scanner();
    const leagues = parseSmallLeagues(await source.xml('worlddetails', '2.0'));
    catalogueCache = { leagues, expires: Date.now() + 24 * 60 * 60 * 1000, checkedAt: new Date().toISOString() };
  }
  return catalogueCache;
}

function ids(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.length || value.length > BATCH_SIZE ||
    value.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(value).size !== value.length) return null;
  return value as number[];
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

/** Only the helper's bounded, complete list can be saved; scan queues never reach DB. */
export function snapshotInput(value: unknown): ForgeLeagueSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.populationComplete !== true || input.job !== null || !validDate(input.populatedAt) ||
    !(input.availabilityAt === null || validDate(input.availabilityAt)) ||
    !Array.isArray(input.teams) || input.teams.length > FORGE_LEAGUE_TEAM_LIMIT ||
    (input.availabilityMethod !== undefined && !['teamdetails', 'matches'].includes(String(input.availabilityMethod)))) return null;
  const teams: ForgeLeagueTeam[] = [];
  const unique = new Set<number>();
  for (const raw of input.teams) {
    if (!raw || typeof raw !== 'object') return null;
    const team = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(team.teamId) || Number(team.teamId) <= 0 || unique.has(Number(team.teamId)) ||
      !Number.isSafeInteger(team.managerId) || Number(team.managerId) <= 0 ||
      typeof team.teamName !== 'string' || !team.teamName.trim() || team.teamName.length > 200 ||
      typeof team.managerName !== 'string' || !team.managerName.trim() || team.managerName.length > 200 ||
      !(team.managerCountryId === undefined || team.managerCountryId === null ||
        (Number.isSafeInteger(team.managerCountryId) && Number(team.managerCountryId) > 0)) ||
      !(team.supporterTier === undefined || team.supporterTier === null ||
        ['silver', 'gold', 'platinum', 'diamond'].includes(String(team.supporterTier).toLowerCase())) ||
      !(team.lastLoginDate === undefined || team.lastLoginDate === null || validDate(team.lastLoginDate)) ||
      !(team.countryId === null || (Number.isSafeInteger(team.countryId) && Number(team.countryId) > 0)) ||
      ![null, true, false].includes(team.booked as boolean | null) || ![null, true, false].includes(team.inCup as boolean | null) ||
      !(team.checkedAt === null || validDate(team.checkedAt)) ||
      !(team.error === null || (typeof team.error === 'string' && team.error.length <= 500))) return null;
    unique.add(Number(team.teamId));
    teams.push({ teamId: Number(team.teamId), teamName: team.teamName, managerId: Number(team.managerId), managerName: team.managerName,
      managerCountryId: team.managerCountryId == null ? null : Number(team.managerCountryId),
      supporterTier: team.supporterTier == null ? null : String(team.supporterTier).toLowerCase(),
      lastLoginDate: team.lastLoginDate == null ? null : team.lastLoginDate as string,
      countryId: team.countryId as number | null, booked: team.booked as boolean | null, inCup: team.inCup as boolean | null,
      checkedAt: team.checkedAt as string | null, error: team.error as string | null });
  }
  return { teams, populatedAt: input.populatedAt, availabilityAt: input.availabilityAt as string | null,
    populationComplete: true, job: null,
    ...(input.availabilityMethod ? { availabilityMethod: input.availabilityMethod as 'teamdetails' | 'matches' } : {}) };
}

async function checkTeam(source: Awaited<ReturnType<typeof scanner>>, leagueId: number, teamId: number, precise: boolean) {
  const xml = await source.xml('teamdetails', '3.9', { teamID: String(teamId) });
  const team = parseLeagueTeam(xml, leagueId, teamId);
  if (!team) return null;
  Object.assign(team, parseLeagueAvailability(xml, teamId));
  if (precise && team.inCup !== true) {
    try {
      const matchesXml = await source.xml('matches', '2.9', { teamID: String(teamId) });
      if (Number(matchesXml.match(/<Team>[\s\S]*?<TeamID>(\d+)<\/TeamID>/i)?.[1]) !== teamId ||
        !/<MatchList(?:\s*\/\s*>|>[\s\S]*?<\/MatchList>)/i.test(matchesXml)) throw new Error('Incomplete fixture list.');
      const matches = parseMatchesXml(matchesXml);
      if (matches.length !== xmlBlocks(matchesXml, 'Match').length || matches.some(match =>
        !match.matchType || !match.homeTeamId || !match.awayTeamId || !parseChppStockholmDate(match.matchDate))) throw new Error('Incomplete fixture entries.');
      const bookedFriendly = matches.some(match => {
        const status = match.status.toUpperCase();
        const date = parseChppStockholmDate(match.matchDate)!;
        return [4, 5, 8, 9].includes(match.matchType) && [match.homeTeamId, match.awayTeamId].includes(teamId) &&
          (status === 'ONGOING' || (date.getTime() > Date.now() && !['FINISHED', 'COMPLETED', 'CANCELLED'].includes(status)));
      });
      team.booked = team.booked === true || bookedFriendly;
      if (team.inCup === null && matches.some(match => match.matchType === 3 &&
        [match.homeTeamId, match.awayTeamId].includes(teamId) && ['UPCOMING', 'ONGOING'].includes(match.status.toUpperCase()))) team.inCup = true;
    } catch {
      team.booked = team.booked === true ? true : null;
      team.error = 'Matches check failed. Availability is not confirmed.';
    }
  }
  team.checkedAt = new Date().toISOString();
  if ((team.booked === null || team.inCup === null) && !team.error) team.error = 'Hattrick did not confirm all availability fields.';
  return team;
}

export default async function handleForgeLeagues(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (rejectIfForgeTestingUnauthorized(req, res)) return;
  const action = String(req.query.action || 'catalogue');
  const outreachActions = ['outreach', 'outreach-contact', 'outreach-import-local'];
  const allActions = ['catalogue', 'snapshot', 'populate', 'series', 'teams', 'availability', 'precise', 'save', ...outreachActions];
  if (!allActions.includes(action)) return res.status(400).json({ error: 'Unknown league action.' });
  if (req.method !== (['catalogue', 'snapshot', 'outreach'].includes(action) ? 'GET' : 'POST')) return res.status(405).json({ error: 'Method not allowed.' });
  if (action === 'outreach') {
    const db = getServiceSupabase();
    const [{ data: campaigns, error: campaignsError }, { data: contacts, error: contactsError }] = await Promise.all([
      db.from(OUTREACH_CAMPAIGNS).select('id, name, campaign_date').order('campaign_date', { ascending: false }),
      db.from(OUTREACH_CONTACTS).select('campaign_id, manager_id'),
    ]);
    if (campaignsError || contactsError) throw new Error('Outreach history is unavailable.');
    return res.status(200).json({
      campaigns: (campaigns || []).map((row) => ({
        id: row.id, name: row.name, campaignDate: row.campaign_date,
      })),
      contacts: (contacts || []).map((row) => ({
        campaignId: row.campaign_id, managerId: Number(row.manager_id),
      })),
    });
  }
  if (outreachActions.includes(action)) {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
    const campaignId = typeof body.campaignId === 'string' ? body.campaignId : '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(campaignId)) return res.status(400).json({ error: 'Invalid campaign.' });
    const db = getServiceSupabase();
    if (action === 'outreach-contact') {
      const managerId = body.managerId;
      if (!Number.isSafeInteger(managerId) || Number(managerId) <= 0)
        return res.status(400).json({ error: 'Invalid manager contact.' });
      const { data, error } = await db.from(OUTREACH_CONTACTS).upsert({
        campaign_id: campaignId, manager_id: Number(managerId),
      }, { onConflict: 'campaign_id,manager_id', ignoreDuplicates: true }).select('manager_id');
      if (error) throw new Error('Message copied, but the contact could not be recorded.');
      return res.status(200).json({ recorded: Boolean(data?.length) });
    }
    if (body.campaignId !== 'around-the-world-in-one-twenty' || !Array.isArray(body.managerIds) || body.managerIds.length > 10000)
      return res.status(400).json({ error: 'Invalid local outreach import.' });
    const rawIds = body.managerIds;
    const validIds = rawIds.filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0) as number[];
    const uniqueIds = [...new Set(validIds)];
    const duplicateInputCount = validIds.length - uniqueIds.length;
    const invalidRows = rawIds.flatMap((id, index) => Number.isSafeInteger(id) && Number(id) > 0 ? [] : [{ index, value: id }]);
    const { data: inserted, error } = uniqueIds.length
      ? await db.from(OUTREACH_CONTACTS).upsert(uniqueIds.map((managerId) => ({
        campaign_id: campaignId, manager_id: managerId,
      })), { onConflict: 'campaign_id,manager_id', ignoreDuplicates: true }).select('manager_id')
      : { data: [], error: null };
    if (error) throw new Error('Could not import all saved contacts. Retry is safe; existing contacts are retained.');
    return res.status(200).json({
      submittedRows: rawIds.length,
      uniqueValidIds: uniqueIds.length,
      imported: inserted?.length || 0,
      alreadyPresent: uniqueIds.length - (inserted?.length || 0),
      duplicateInputCount,
      invalidRows,
      // Manager IDs are stored directly, without requiring team/profile rows.
      unmatchedRows: [],
    });
  }
  if (action === 'catalogue') {
    const data = await catalogue();
    const { data: rows, error } = await getServiceSupabase().from(TABLE).select('league_id').contains('snapshot', { populationComplete: true });
    if (error) throw new Error('League snapshot storage is unavailable.');
    const fetched = new Set((rows || []).map(row => Number(row.league_id)));
    return res.status(200).json({ leagues: data.leagues.map(league => ({ ...league, fetched: fetched.has(league.leagueId) })), checkedAt: data.checkedAt });
  }
  const leagueId = Number(req.query.leagueId);
  if (!Number.isSafeInteger(leagueId) || leagueId <= 0) return res.status(400).json({ error: 'Invalid league ID.' });
  if (action === 'snapshot') {
    const { data, error } = await getServiceSupabase().from(TABLE).select('snapshot, revision').eq('league_id', leagueId).maybeSingle();
    if (error) throw new Error('League snapshot storage is unavailable.');
    return res.status(200).json({ snapshot: data?.snapshot ?? null, revision: data?.revision ?? 0 });
  }
  if (!(await catalogue()).leagues.some(league => league.leagueId === leagueId)) return res.status(400).json({ error: `Only leagues with 1–${FORGE_LEAGUE_TEAM_LIMIT} active teams can be scanned.` });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  if (action === 'save') {
    const snapshot = snapshotInput(body.snapshot);
    const revision = body.revision;
    const saveId = body.saveId;
    if (!snapshot || !Number.isInteger(revision) || Number(revision) < 0 || Number(revision) >= 2147483647 ||
      typeof saveId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(saveId)) return res.status(400).json({ error: 'Invalid completed league snapshot.' });
    const db = getServiceSupabase();
    const { data: row, error: readError } = await db.from(TABLE).select('revision, snapshot').eq('league_id', leagueId).maybeSingle();
    if (readError) throw new Error('Could not read the saved list.');
    // Retrying a lost completion response must not write the snapshot again.
    if (row?.snapshot?.saveId === saveId) return res.status(200).json({ snapshot: row.snapshot, revision: row.revision });
    if ((row?.revision ?? 0) !== revision) return res.status(409).json({ error: 'The saved list changed in another tab. Your results remain in this browser tab.' });
    snapshot.saveId = saveId;
    const record = { snapshot, revision: Number(revision) + 1, updated_at: new Date().toISOString() };
    // The only snapshot write in this handler: exactly one INSERT or UPDATE at completion.
    const result = row
      ? await db.from(TABLE).update(record).eq('league_id', leagueId).eq('revision', revision).select('revision').maybeSingle()
      : await db.from(TABLE).insert({ league_id: leagueId, ...record }).select('revision').single();
    if (result.error?.code === '23505' || (!result.error && !result.data)) return res.status(409).json({ error: 'The saved list changed in another tab. Your results remain in this browser tab.' });
    if (result.error) throw new Error('Could not save the completed list. Results remain in this browser tab; retry saving.');
    return res.status(200).json({ snapshot, revision: result.data!.revision });
  }
  const source = await scanner();
  if (action === 'populate') return res.status(200).json({ seriesIds: parseLeagueSeries(await source.xml('leaguelevels', '1.0', { LeagueID: String(leagueId) }), leagueId) });
  const requestedIds = ids(action === 'series' ? body.seriesIds : body.teamIds);
  if (!requestedIds) return res.status(400).json({ error: `Provide 1–${BATCH_SIZE} distinct positive IDs.` });
  if (action === 'series') {
    const candidates = await Promise.all(requestedIds.map(async id => parseSeriesHumanTeams(await source.xml('leaguedetails', '1.6', { leagueLevelUnitID: String(id) }), leagueId, id)));
    return res.status(200).json({ candidateIds: [...new Set(candidates.flat())] });
  }
  const results = await Promise.all(requestedIds.map(async teamId => {
    if (action === 'teams') return { teamId, team: parseLeagueTeam(await source.xml('teamdetails', '3.9', { teamID: String(teamId) }), leagueId, teamId) };
    try { return { teamId, team: await checkTeam(source, leagueId, teamId, action === 'precise') }; }
    catch { return { teamId, error: 'Availability could not be confirmed. Refresh to retry.' }; }
  }));
  return res.status(200).json({ results });
}
