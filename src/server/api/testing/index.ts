import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  acceptChppChallengeDirect,
  checkChppChallengeable,
  parseChppBaseResponse,
  parseChppChallengeOffers,
  parseChppRequestOptionsFromQuery,
  selectPendingChallengeFromTeam,
  sendChppChallengeDirect,
  viewChppChallenges,
} from '../_lib/chpp-challenges.js';
import {
  fetchManagerTeamsFromChpp,
  fetchTeamBookingStatus,
  fetchTeamDetailsFromChpp,
  getManagerChppCredentials,
} from '../_lib/matchmaker.js';
import { getServiceSupabase, getSupabase } from '../_lib/supabase.js';
import { isForgeAdminRequest } from '../_lib/forge-session.js';
import { rejectIfForgeTestingUnauthorized } from './_lib/guard.js';
import { beautifyXml } from './_lib/xml-format.js';
import { getAuthHeader } from '../_lib/chpp-auth.js';
import {
  getFootballScore,
  getPenaltyShootoutScore,
  mapMatchEventDetailsToFixture,
  parseMatchEventDetails,
} from '../_lib/chpp-match-events.js';
import type { ChppTeamOption } from '../_lib/chpp-xml.js';
import type { ChallengeableDirectoryUser, ForgeDirectoryTeam } from '../../../utils/forge-team-directory.js';

function value(req: VercelRequest, key: string) {
  const raw = req.query[key];
  return String(Array.isArray(raw) ? raw[0] : raw || '').trim();
}

function numberValue(req: VercelRequest, key: string) {
  const parsed = Number(value(req, key));
  return Number.isFinite(parsed) ? parsed : null;
}

function bodyRecord(req: VercelRequest): Record<string, unknown> | null {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : null;
}

function requestValue(req: VercelRequest, key: string): unknown {
  return bodyRecord(req)?.[key] ?? req.query[key];
}

function requestString(req: VercelRequest, key: string) {
  const raw = requestValue(req, key);
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
  return String(raw ?? '').trim();
}

function requestNumber(req: VercelRequest, key: string) {
  const parsed = Number(requestString(req, key));
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveManager(req: VercelRequest) {
  const managerId = requestNumber(req, 'managerId') ?? numberValue(req, 'managerId');
  if (!managerId) return { error: 'Missing managerId.' } as const;
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return { error: 'CHPP server configuration is missing.' } as const;
  const credentials = await getManagerChppCredentials(getSupabase(), managerId);
  if (!credentials) return { error: 'No stored OAuth credentials for this manager.' } as const;
  return { managerId, consumerKey, consumerSecret, credentials } as const;
}

function authInput(context: Awaited<ReturnType<typeof resolveManager>>) {
  if ('error' in context) return null;
  return {
    consumerKey: context.consumerKey,
    consumerSecret: context.consumerSecret,
    oauthToken: context.credentials.oauth_token,
    oauthTokenSecret: context.credentials.oauth_token_secret,
  };
}

function manifest() {
  return {
    tools: [
      { id: 'credentials-check', label: 'Credentials check' },
      { id: 'challenges-view', label: 'Challenges view' },
      { id: 'challengeable', label: 'Challengeable check' },
      { id: 'challengeable-directory', label: 'Challengeable teams directory' },
      { id: 'challengeable-directory-refresh', label: 'Refresh listed directory teams' },
      { id: 'challenges-compare', label: 'Challenges comparison' },
      { id: 'booking-status', label: 'Booking status' },
      { id: 'challenge-send', label: 'Challenge send', sideEffect: true },
      { id: 'challenge-accept', label: 'Challenge accept', sideEffect: true },
      { id: 'round-press-matchdetails-backfill', label: 'Round press MatchDetails backfill', sideEffect: true },
    ],
  };
}

async function handleRoundPressMatchDetailsBackfill(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const tournamentId = value(req, 'tournamentId');
  const seasonNumber = numberValue(req, 'seasonNumber');
  const roundNumber = numberValue(req, 'roundNumber');
  const apply = value(req, 'apply') === '1';
  if (!tournamentId || !seasonNumber || !roundNumber) {
    return res.status(400).json({ error: 'tournamentId, seasonNumber, and roundNumber are required.' });
  }

  const supabase = getServiceSupabase();
  const { data: round, error: roundError } = await supabase
    .from('rounds')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('season_number', seasonNumber)
    .eq('round_number', roundNumber)
    .maybeSingle();
  if (roundError) throw roundError;
  if (!round) return res.status(404).json({ error: 'Round not found.' });

  const { data: matches, error: matchesError } = await supabase
    .from('matches')
    .select('id, ht_match_id, home_team:teams!matches_home_team_id_fkey(ht_team_id), away_team:teams!matches_away_team_id_fkey(ht_team_id)')
    .eq('round_id', round.id)
    .not('ht_match_id', 'is', null);
  if (matchesError) throw matchesError;
  if (!matches?.length) return res.status(422).json({ error: 'Round has no linked Hattrick matches.' });
  if (matches.length > 10) return res.status(422).json({ error: 'Backfill is limited to ten matches per request.' });

  const url = 'https://chpp.hattrick.org/chppxml.ashx';
  const refreshed = [];
  for (const match of matches) {
    const htMatchId = Number(match.ht_match_id);
    const params = { file: 'matchdetails', version: '3.1', matchID: String(htMatchId), matchEvents: 'true' };
    const authHeader = getAuthHeader('GET', url, params, context.consumerKey, context.consumerSecret, context.credentials.oauth_token, context.credentials.oauth_token_secret);
    const response = await fetch(`${url}?file=matchdetails&version=3.1&matchEvents=true&matchID=${htMatchId}`, { headers: { Authorization: authHeader } });
    const xml = await response.text();
    if (!response.ok || /<Error/i.test(xml)) {
      refreshed.push({ matchId: match.id, htMatchId, refreshed: false, error: 'CHPP MatchDetails was unavailable.' });
      continue;
    }

    const homeTeam = match.home_team as { ht_team_id?: number | null } | null;
    const awayTeam = match.away_team as { ht_team_id?: number | null } | null;
    const details = mapMatchEventDetailsToFixture(
      parseMatchEventDetails(xml),
      typeof homeTeam?.ht_team_id === 'number' ? homeTeam.ht_team_id : null,
      typeof awayTeam?.ht_team_id === 'number' ? awayTeam.ht_team_id : null,
    );
    const footballScore = getFootballScore(details);
    const shootout = getPenaltyShootoutScore(details);
    if (apply) {
      const { error } = await supabase.from('matches').update({
        match_event_details: details,
        home_goals: footballScore?.home ?? null,
        away_goals: footballScore?.away ?? null,
        went_120: details.result?.reached120 ?? false,
        penalty_shootout_home_goals: shootout.home,
        penalty_shootout_away_goals: shootout.away,
      }).eq('id', match.id);
      if (error) throw error;
    }
    refreshed.push({
      matchId: match.id,
      htMatchId,
      refreshed: true,
      persisted: apply,
      version: details.version,
      result: details.result,
    });
  }
  return res.status(200).json({ tool: 'round-press-matchdetails-backfill', tournamentId, seasonNumber, roundNumber, apply, refreshed });
}

async function handleCredentials(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  let teams: Array<{ teamId: number; teamName: string }> = [];
  try {
    const snapshot = await fetchManagerTeamsFromChpp(
      context.consumerKey,
      context.consumerSecret,
      context.credentials,
      context.managerId,
    );
    teams = snapshot.teams.map((team) => ({ teamId: team.teamId, teamName: team.teamName }));
  } catch {
    // Credentials are still useful to inspect even when managercompendium is unavailable.
  }
  return res.status(200).json({
    managerId: context.managerId,
    hasCredentials: true,
    managerName: context.credentials.manager_name,
    teamsFromChpp: teams,
    chppConfigured: true,
  });
}

async function handleView(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const auth = authInput(context);
  const teamId = numberValue(req, 'teamId');
  const result = await viewChppChallenges({
    ...auth!,
    teamId: teamId || undefined,
    isWeekendFriendly: value(req, 'isWeekendFriendly') === '1' ? 1 : 0,
    requestOptions: parseChppRequestOptionsFromQuery(req.query),
  });
  return res.status(200).json({
    tool: 'challenges-view',
    chppHttpStatus: result.httpStatus,
    requestUrl: result.requestUrl,
    requestParams: result.params,
    parsed: result.parsed,
    rawXml: result.rawXml,
    rawXmlFormatted: beautifyXml(result.rawXml),
  });
}

async function handleChallengeable(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const teamId = numberValue(req, 'teamId');
  const opponentTeamId = numberValue(req, 'opponentTeamId');
  if (!teamId || !opponentTeamId) return res.status(400).json({ error: 'Missing teamId or opponentTeamId.' });
  const result = await checkChppChallengeable({
    ...authInput(context)!,
    teamId,
    suggestedTeamIds: [opponentTeamId],
    isWeekendFriendly: value(req, 'isWeekendFriendly') === '1' ? 1 : 0,
    requestOptions: parseChppRequestOptionsFromQuery(req.query),
  });
  const { responseTeamId, responseTeamName, teams } = result.parsed;
  return res.status(200).json({
    tool: 'challengeable',
    requestedTeamId: teamId,
    responseTeamId,
    responseTeamName,
    teams,
    chppHttpStatus: result.httpStatus,
    requestUrl: result.requestUrl,
    requestParams: result.params,
    parsed: result.parsed,
    rawXml: result.rawXml,
    rawXmlFormatted: beautifyXml(result.rawXml),
  });
}

async function handleCompare(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const teamId = numberValue(req, 'teamId');
  const opponentTeamId = numberValue(req, 'opponentTeamId');
  if (!teamId || !opponentTeamId) return res.status(400).json({ error: 'Missing teamId or opponentTeamId.' });
  const auth = authInput(context)!;
  const isWeekendFriendly = value(req, 'isWeekendFriendly') === '1' ? 1 : 0;
  const variants = [
    { label: 'view-default', kind: 'view' as const, options: {} },
    { label: 'challengeable-default', kind: 'challengeable' as const, options: {} },
    { label: 'challengeable-no-version', kind: 'challengeable' as const, options: { version: null } },
    { label: 'challengeable-no-weekend', kind: 'challengeable' as const, options: { includeWeekendParam: false } },
  ];
  const runs = [];
  for (const variant of variants) {
    const result = variant.kind === 'view'
      ? await viewChppChallenges({ ...auth, teamId, isWeekendFriendly, requestOptions: variant.options })
      : await checkChppChallengeable({
          ...auth,
          teamId,
          suggestedTeamIds: [opponentTeamId],
          isWeekendFriendly,
          requestOptions: variant.options,
        });
    runs.push({
      variant: variant.label,
      httpStatus: result.httpStatus,
      requestUrl: result.requestUrl,
      requestParams: result.params,
      parsed: result.parsed,
      rawXmlFormatted: beautifyXml(result.rawXml),
    });
  }
  return res.status(200).json({ tool: 'challenges-compare', managerId: context.managerId, teamId, opponentTeamId, runs });
}

async function handleBooking(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const teamId = numberValue(req, 'teamId');
  if (!teamId) return res.status(400).json({ error: 'Missing teamId.' });
  const booking = await fetchTeamBookingStatus(context.consumerKey, context.consumerSecret, context.credentials, teamId);
  return res.status(200).json({
    teamId,
    isBooked: booking.isBooked,
    match: booking.match,
    hint: booking.isBooked ? 'An upcoming friendly is booked for this team.' : 'No booked friendly detected via matches.',
  });
}

async function handleSend(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const teamId = numberValue(req, 'teamId');
  const opponentTeamId = numberValue(req, 'opponentTeamId');
  if (!teamId || !opponentTeamId) return res.status(400).json({ error: 'Missing teamId or opponentTeamId.' });
  if (value(req, 'confirm') !== '1') {
    return res.status(400).json({ error: 'Confirm the side effect before sending a real CHPP challenge.' });
  }
  const result = await sendChppChallengeDirect({
    ...authInput(context)!,
    teamId,
    opponentTeamId,
    matchType: Number(value(req, 'matchType') || '1') === 1 ? 1 : 0,
    matchPlace: 0,
    requestOptions: parseChppRequestOptionsFromQuery(req.query),
  });
  return res.status(result.success ? 200 : 502).json({
    tool: 'challenge-send',
    success: result.success,
    trainingMatchId: result.trainingMatchId,
    error: result.errorMessage,
    rawXml: result.rawXml,
    rawXmlFormatted: result.rawXml ? beautifyXml(result.rawXml) : undefined,
    warning: 'This created a real Hattrick challenge side effect.',
  });
}

async function handleAccept(req: VercelRequest, res: VercelResponse) {
  const context = await resolveManager(req);
  if ('error' in context) return res.status(400).json(context);
  const teamId = requestNumber(req, 'teamId');
  const opponentTeamId = requestNumber(req, 'acceptFromTeamId');
  if (teamId === null || !Number.isSafeInteger(teamId) || teamId <= 0 ||
      opponentTeamId === null || !Number.isSafeInteger(opponentTeamId) || opponentTeamId <= 0) {
    return res.status(400).json({ error: 'Missing receiving team or challenger team ID.' });
  }
  if (requestString(req, 'confirm') !== '1') {
    return res.status(400).json({ error: 'Confirm the side effect before accepting a real CHPP challenge.' });
  }

  const auth = authInput(context)!;
  const isWeekendFriendly = requestString(req, 'isWeekendFriendly') === '1' ? 1 : 0;
  const view = await viewChppChallenges({ ...auth, teamId, isWeekendFriendly });
  if (view.httpStatus < 200 || view.httpStatus >= 300) {
    return res.status(502).json({ error: `Could not load incoming challenges (${view.httpStatus}).` });
  }
  const viewError = parseChppBaseResponse(view.rawXml);
  if (viewError.errorCode !== undefined && viewError.errorCode !== 0) {
    return res.status(502).json({ error: viewError.errorMessage || `CHPP returned error ${viewError.errorCode}.` });
  }

  const selected = selectPendingChallengeFromTeam(parseChppChallengeOffers(view.rawXml), opponentTeamId);
  if (selected.matchingTrainingMatchIds.length === 0) {
    return res.status(409).json({
      tool: 'challenge-accept',
      success: false,
      teamId,
      challengerTeamId: opponentTeamId,
      error: 'No pending incoming challenge from that team was found.',
    });
  }
  if (selected.matchingTrainingMatchIds.length > 1) {
    return res.status(409).json({
      tool: 'challenge-accept',
      success: false,
      teamId,
      challengerTeamId: opponentTeamId,
      error: 'More than one pending challenge matches that team; inspect Challenges view before accepting.',
      matchingTrainingMatchIds: selected.matchingTrainingMatchIds,
    });
  }

  const offer = selected.offer!;
  const result = await acceptChppChallengeDirect({
    ...auth,
    teamId,
    trainingMatchId: offer.trainingMatchId!,
    isWeekendFriendly,
    requestOptions: parseChppRequestOptionsFromQuery(req.query),
  });
  return res.status(result.success ? 200 : 502).json({
    tool: 'challenge-accept',
    success: result.success,
    teamId,
    challengerTeamId: opponentTeamId,
    trainingMatchId: offer.trainingMatchId,
    error: result.errorMessage,
    rawXml: result.rawXml,
    rawXmlFormatted: result.rawXml ? beautifyXml(result.rawXml) : undefined,
    warning: 'This accepted a real Hattrick challenge side effect.',
  });
}

const CHALLENGEABLE_DIRECTORY_PAGE_SIZE = 2;

function challengeableDirectoryFailure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  const statusCode = message.match(/\b(401|403)\b/)?.[1];
  return statusCode
    ? `CHPP rejected the stored access (${statusCode}); it may need to be renewed.`
    : fallback;
}

async function handleChallengeableDirectory(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const cursor = Number(value(req, 'cursor') || '0');
  const challengeManagerId = numberValue(req, 'managerId');
  const challengeTeamId = numberValue(req, 'teamId');
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return res.status(400).json({ error: 'Invalid directory cursor.' });
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return res.status(500).json({ error: 'CHPP server configuration is missing.' });

  const db = getServiceSupabase();
  const { data: profiles, error } = await db.from('profiles')
    .select('hattrick_user_id, manager_name')
    .gt('hattrick_user_id', cursor)
    .order('hattrick_user_id', { ascending: true })
    .limit(CHALLENGEABLE_DIRECTORY_PAGE_SIZE);
  if (error) throw error;

  const directoryUsers: ChallengeableDirectoryUser[] = [];
  const refreshedManagerIds: number[] = [];
  const issues: Array<{ managerId: number; managerName: string; reason: string }> = [];
  let checkedManagers = 0;
  let checkedTeams = 0;
  let unavailableCredentials = 0;
  let failedChecks = 0;
  let unavailableTeams = 0;
  let managersWithNoTeams = 0;
  let managersWithoutAvailableTeams = 0;

  for (const profile of profiles || []) {
    const managerId = Number(profile.hattrick_user_id);
    if (!Number.isSafeInteger(managerId) || managerId <= 0) continue;
    const credentials = await getManagerChppCredentials(db, managerId);
    if (!credentials) {
      unavailableCredentials += 1;
      issues.push({
        managerId,
        managerName: profile.manager_name || 'Unknown manager',
        reason: 'No stored CHPP credentials.',
      });
      continue;
    }
    checkedManagers += 1;

    let teams: ChppTeamOption[];
    try {
      const compendium = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, managerId);
      if (Number(compendium.hattrickUserId) !== managerId) throw new Error('CHPP did not identify the requested manager.');
      teams = compendium.teams;
    } catch (teamListError) {
      failedChecks += 1;
      issues.push({
        managerId,
        managerName: profile.manager_name || credentials.manager_name || 'Unknown manager',
        reason: challengeableDirectoryFailure(teamListError, 'Could not load the current team list from CHPP.'),
      });
      console.warn(`Could not load team list for Forge challengeable directory manager ${managerId}:`, teamListError);
      continue;
    }

    if (teams.length === 0) managersWithNoTeams += 1;
    refreshedManagerIds.push(managerId);
    const scannedTeams: ForgeDirectoryTeam[] = [];
    for (const team of teams) {
      const teamId = Number(team.teamId);
      if (!Number.isSafeInteger(teamId) || teamId <= 0) continue;
      const result: ForgeDirectoryTeam = {
        teamId, teamName: team.teamName,
        countryId: team.countryId, countryName: team.countryName, leagueId: team.leagueId,
        booked: null, inCup: null, challengeableMidweek: null, challengeableWeekend: null,
        checkedAt: '',
      };
      checkedTeams += 1;
      try {
        const details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, teamId);
        if (details.errorCode) throw new Error('CHPP teamdetails returned an error.');
        result.teamName = details.teamName || team.teamName;
        result.countryId = details.countryId ?? team.countryId;
        result.countryName = details.countryName ?? team.countryName;
        result.leagueId = details.leagueId ?? team.leagueId;
        result.inCup = details.stillInCup ?? null;
        if (Number(details.friendlyTeamId) > 0) result.booked = true;
      } catch (teamError) {
        failedChecks += 1;
        issues.push({
          managerId,
          managerName: profile.manager_name || credentials.manager_name || 'Unknown manager',
          reason: `Team ${teamId}: ${challengeableDirectoryFailure(teamError, 'Could not load team availability from CHPP.')}`,
        });
        console.warn(`Could not check Forge challengeable directory team ${teamId}:`, teamError);
      }
      // Always check fixtures, even when challenges are disabled or teamdetails
      // is temporarily missing fields during live play.
      try {
        const booking = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, teamId);
        const ongoingFriendly = booking.scheduledMatches?.some(match =>
          [4, 5, 8, 9].includes(match.matchType) && [match.homeTeamId, match.awayTeamId].includes(teamId) &&
          match.status.toUpperCase() === 'ONGOING');
        result.booked = result.booked === true || booking.isBooked || ongoingFriendly ? true : booking.scheduledMatches ? false : null;
        if (!booking.isBooked && !booking.scheduledMatches) {
          failedChecks += 1;
          issues.push({ managerId, managerName: profile.manager_name || credentials.manager_name || 'Unknown manager',
            reason: `Team ${teamId}: Hattrick did not return an identified, complete fixture list.` });
        }
        if (result.inCup === null && booking.scheduledMatches?.some(match =>
          match.matchType === 3 && [match.homeTeamId, match.awayTeamId].includes(teamId) &&
          ['UPCOMING', 'ONGOING'].includes(match.status.toUpperCase()))) result.inCup = true;
      } catch (bookingError) {
        failedChecks += 1;
        issues.push({ managerId, managerName: profile.manager_name || credentials.manager_name || 'Unknown manager',
          reason: `Team ${teamId}: ${challengeableDirectoryFailure(bookingError, 'Could not verify booking status.')}` });
      }
      result.checkedAt = new Date().toISOString();
      if (result.teamId !== challengeTeamId && result.booked === false && result.inCup === false) scannedTeams.push(result);
      else unavailableTeams += 1;
    }

    if (teams.length > 0 && !scannedTeams.some(team => team.booked === false && team.inCup === false)) {
      managersWithoutAvailableTeams += 1;
    }

    directoryUsers.push({
      managerId,
      managerName: profile.manager_name || credentials.manager_name || 'Unknown manager',
      teams: scannedTeams,
    });
  }

  // `challengeable` is directional and opponent-specific. Check only the
  // available teams from this batch, using the selected manager/team as the
  // challenger, instead of treating teamdetails' broad flags as exact results.
  const hasChallengeSource = Number.isSafeInteger(challengeManagerId) && (challengeManagerId ?? 0) > 0 &&
    Number.isSafeInteger(challengeTeamId) && (challengeTeamId ?? 0) > 0;
  if (hasChallengeSource && challengeManagerId !== null && challengeTeamId !== null) {
    const challengerCredentials = await getManagerChppCredentials(db, challengeManagerId);
    if (!challengerCredentials) {
      failedChecks += 1;
      issues.push({
        managerId: challengeManagerId,
        managerName: 'Selected team',
        reason: 'No stored CHPP credentials for the selected team; pair-specific challengeability is unknown.',
      });
    } else {
      const availableTeams = directoryUsers.flatMap(user => user.teams);
      const opponentTeamIds = [...new Set(availableTeams.map(team => team.teamId).filter(id => id !== challengeTeamId))];
      const friendlyWindows = [
        { isWeekendFriendly: 0 as const, key: 'challengeableMidweek' as const },
        { isWeekendFriendly: 1 as const, key: 'challengeableWeekend' as const },
      ];

      for (const window of friendlyWindows) {
        for (let start = 0; start < opponentTeamIds.length; start += 50) {
          const batchTeamIds = opponentTeamIds.slice(start, start + 50);
          try {
            const result = await checkChppChallengeable({
              consumerKey,
              consumerSecret,
              oauthToken: challengerCredentials.oauth_token,
              oauthTokenSecret: challengerCredentials.oauth_token_secret,
              teamId: challengeTeamId,
              suggestedTeamIds: batchTeamIds,
              isWeekendFriendly: window.isWeekendFriendly,
            });
            if (result.parsed.responseTeamId !== challengeTeamId || (result.parsed.errorCode && result.parsed.errorCode !== 0)) {
              throw new Error(result.parsed.errorMessage || 'CHPP returned a mismatched team or an error.');
            }

            const resultsByTeamId = new Map(result.parsed.teams.map(team => [team.teamId, team.challengeable]));
            for (const candidate of availableTeams) {
              if (!batchTeamIds.includes(candidate.teamId)) continue;
              candidate[window.key] = resultsByTeamId.get(candidate.teamId) ?? null;
              if (candidate[window.key] === null) {
                failedChecks += 1;
                issues.push({
                  managerId: challengeManagerId,
                  managerName: 'Selected team',
                  reason: `CHPP did not return a ${window.isWeekendFriendly ? 'weekend' : 'midweek'} challengeability value for team ${candidate.teamId}.`,
                });
              }
            }
          } catch (challengeError) {
            failedChecks += batchTeamIds.length;
            issues.push({
              managerId: challengeManagerId,
              managerName: 'Selected team',
              reason: challengeableDirectoryFailure(
                challengeError,
                `Could not check ${window.isWeekendFriendly ? 'weekend' : 'midweek'} challengeability for the available teams.`,
              ),
            });
          }
        }
      }
    }
  } else if ((challengeManagerId ?? 0) > 0 || (challengeTeamId ?? 0) > 0) {
    failedChecks += 1;
    issues.push({
      managerId: challengeManagerId && challengeManagerId > 0 ? challengeManagerId : 0,
      managerName: 'Selected team',
      reason: 'Set both Manager ID and My team ID above to check pair-specific challengeability.',
    });
  }

  const hasMore = (profiles || []).length === CHALLENGEABLE_DIRECTORY_PAGE_SIZE;
  const lastProfile = profiles?.[profiles.length - 1];
  return res.status(200).json({
    tool: 'challengeable-directory',
    users: directoryUsers,
    refreshedManagerIds,
    scannedManagerIds: (profiles || []).map(profile => Number(profile.hattrick_user_id)),
    scannedProfiles: (profiles || []).length,
    checkedManagers,
    checkedTeams,
    unavailableCredentials,
    failedChecks,
    unavailableTeams,
    managersWithNoTeams,
    managersWithoutAvailableTeams,
    issues,
    nextCursor: hasMore && lastProfile ? Number(lastProfile.hattrick_user_id) : null,
    hasMore,
  });
}

async function handleChallengeableDirectoryRefresh(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const rawTeams = requestValue(req, 'teams');
  if (!Array.isArray(rawTeams) || rawTeams.length > 100) {
    return res.status(400).json({ error: 'Provide up to 100 currently listed manager/team pairs.' });
  }
  const requested = rawTeams.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const pair = raw as Record<string, unknown>;
    const managerId = Number(pair.managerId);
    const teamId = Number(pair.teamId);
    return Number.isSafeInteger(managerId) && managerId > 0 && Number.isSafeInteger(teamId) && teamId > 0
      ? [{ managerId, teamId }]
      : [];
  });
  if (requested.length !== rawTeams.length) return res.status(400).json({ error: 'Invalid manager/team pair.' });

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return res.status(500).json({ error: 'CHPP server configuration is missing.' });

  const db = getServiceSupabase();
  const managerIds = [...new Set(requested.map(pair => pair.managerId))];
  const { data: profiles, error: profilesError } = await db.from('profiles')
    .select('hattrick_user_id, manager_name')
    .in('hattrick_user_id', managerIds);
  if (profilesError) throw profilesError;
  const profilesById = new Map((profiles || []).map(profile => [Number(profile.hattrick_user_id), profile]));

  const available: Array<{ managerId: number; managerName: string; team: ForgeDirectoryTeam }> = [];
  const refreshedTeamIds: string[] = [];
  const issues: Array<{ managerId: number; managerName: string; reason: string }> = [];
  let checkedTeams = 0;
  let unavailableTeams = 0;
  let failedChecks = 0;

  for (const managerId of managerIds) {
    const profile = profilesById.get(managerId);
    const managerName = profile?.manager_name || 'Unknown manager';
    const requestedTeams = requested.filter(pair => pair.managerId === managerId);
    const credentials = await getManagerChppCredentials(db, managerId);
    if (!profile || !credentials) {
      failedChecks += requestedTeams.length;
      issues.push({ managerId, managerName, reason: 'No stored CHPP credentials for this manager.' });
      continue;
    }

    let currentTeams: ChppTeamOption[];
    try {
      const compendium = await fetchManagerTeamsFromChpp(consumerKey, consumerSecret, credentials, managerId);
      if (Number(compendium.hattrickUserId) !== managerId) throw new Error('CHPP did not identify the requested manager.');
      currentTeams = compendium.teams;
    } catch (error) {
      failedChecks += requestedTeams.length;
      issues.push({ managerId, managerName, reason: challengeableDirectoryFailure(error, 'Could not verify the manager team list.') });
      continue;
    }
    const currentTeamIds = new Set(currentTeams.map(team => Number(team.teamId)));

    for (const pair of requestedTeams) {
      if (!currentTeamIds.has(pair.teamId)) {
        refreshedTeamIds.push(`${managerId}:${pair.teamId}`);
        unavailableTeams += 1;
        continue;
      }
      const teamSnapshot = currentTeams.find(team => Number(team.teamId) === pair.teamId)!;
      const result: ForgeDirectoryTeam = {
        teamId: pair.teamId,
        teamName: teamSnapshot.teamName,
        countryId: teamSnapshot.countryId,
        countryName: teamSnapshot.countryName,
        leagueId: teamSnapshot.leagueId,
        booked: null,
        inCup: null,
        challengeableMidweek: null,
        challengeableWeekend: null,
        checkedAt: new Date().toISOString(),
      };
      checkedTeams += 1;
      let availabilityVerified = true;
      try {
        const details = await fetchTeamDetailsFromChpp(consumerKey, consumerSecret, credentials, pair.teamId);
        if (details.errorCode) throw new Error('CHPP teamdetails returned an error.');
        result.teamName = details.teamName || result.teamName;
        result.countryId = details.countryId ?? result.countryId;
        result.countryName = details.countryName ?? result.countryName;
        result.leagueId = details.leagueId ?? result.leagueId;
        result.inCup = details.stillInCup ?? null;
        if (Number(details.friendlyTeamId) > 0) result.booked = true;
      } catch (error) {
        availabilityVerified = false;
        failedChecks += 1;
        issues.push({ managerId, managerName, reason: `Team ${pair.teamId}: ${challengeableDirectoryFailure(error, 'Could not load team availability from CHPP.')}` });
      }
      try {
        const booking = await fetchTeamBookingStatus(consumerKey, consumerSecret, credentials, pair.teamId);
        const ongoingFriendly = booking.scheduledMatches?.some(match =>
          [4, 5, 8, 9].includes(match.matchType) && [match.homeTeamId, match.awayTeamId].includes(pair.teamId) &&
          match.status.toUpperCase() === 'ONGOING');
        result.booked = result.booked === true || booking.isBooked || ongoingFriendly ? true : booking.scheduledMatches ? false : null;
        if (!booking.isBooked && !booking.scheduledMatches) availabilityVerified = false;
        if (result.inCup === null && booking.scheduledMatches?.some(match =>
          match.matchType === 3 && [match.homeTeamId, match.awayTeamId].includes(pair.teamId) &&
          ['UPCOMING', 'ONGOING'].includes(match.status.toUpperCase()))) result.inCup = true;
      } catch (error) {
        availabilityVerified = false;
        failedChecks += 1;
        issues.push({ managerId, managerName, reason: `Team ${pair.teamId}: ${challengeableDirectoryFailure(error, 'Could not verify booking status.')}` });
      }
      result.checkedAt = new Date().toISOString();
      if (!availabilityVerified || result.booked === null || result.inCup === null) {
        failedChecks += 1;
        issues.push({ managerId, managerName, reason: `Team ${pair.teamId}: availability could not be confirmed.` });
        continue;
      }
      refreshedTeamIds.push(`${managerId}:${pair.teamId}`);
      if (result.booked === false && result.inCup === false) available.push({ managerId, managerName, team: result });
      else unavailableTeams += 1;
    }
  }

  const challengeManagerId = requestNumber(req, 'managerId');
  const challengeTeamId = requestNumber(req, 'teamId');
  if (challengeManagerId && challengeTeamId) {
    const challengerCredentials = await getManagerChppCredentials(db, challengeManagerId);
    if (challengerCredentials) {
      const candidates = available.filter(candidate => candidate.team.teamId !== challengeTeamId);
      for (const window of [
        { isWeekendFriendly: 0 as const, key: 'challengeableMidweek' as const },
        { isWeekendFriendly: 1 as const, key: 'challengeableWeekend' as const },
      ]) {
        for (let start = 0; start < candidates.length; start += 50) {
          const batch = candidates.slice(start, start + 50);
          try {
            const response = await checkChppChallengeable({
              consumerKey,
              consumerSecret,
              oauthToken: challengerCredentials.oauth_token,
              oauthTokenSecret: challengerCredentials.oauth_token_secret,
              teamId: challengeTeamId,
              suggestedTeamIds: batch.map(candidate => candidate.team.teamId),
              isWeekendFriendly: window.isWeekendFriendly,
            });
            if (response.parsed.responseTeamId !== challengeTeamId || response.parsed.errorCode) {
              throw new Error(response.parsed.errorMessage || 'CHPP returned an invalid challengeability response.');
            }
            const resultById = new Map(response.parsed.teams.map(team => [team.teamId, team.challengeable ?? null]));
            for (const candidate of batch) candidate.team[window.key] = resultById.get(candidate.team.teamId) ?? null;
          } catch (error) {
            failedChecks += batch.length;
            issues.push({ managerId: challengeManagerId, managerName: 'Selected team', reason: challengeableDirectoryFailure(error, `Could not refresh ${window.isWeekendFriendly ? 'weekend' : 'midweek'} challengeability.`) });
          }
        }
      }
    }
  }

  return res.status(200).json({
    tool: 'challengeable-directory-refresh',
    users: [...new Set(available.map(entry => entry.managerId))].map(managerId => ({
      managerId,
      managerName: available.find(entry => entry.managerId === managerId)!.managerName,
      teams: available.filter(entry => entry.managerId === managerId).map(entry => entry.team),
    })),
    refreshedTeamIds,
    checkedTeams,
    unavailableTeams,
    failedChecks,
    issues,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isForgeAdminRequest(req.headers.cookie)) {
    if (rejectIfForgeTestingUnauthorized(req, res)) return;
  }

  const tool = value(req, 'tool').replace(/^\//, '') || 'manifest';
  try {
    switch (tool) {
      case 'credentials-check': return await handleCredentials(req, res);
      case 'challenges-view': return await handleView(req, res);
      case 'challengeable': return await handleChallengeable(req, res);
      case 'challengeable-directory': return await handleChallengeableDirectory(req, res);
      case 'challenges-compare': return await handleCompare(req, res);
      case 'booking-status': return await handleBooking(req, res);
      case 'challenge-send': return await handleSend(req, res);
      case 'challenge-accept': return await handleAccept(req, res);
      case 'challengeable-directory-refresh': return await handleChallengeableDirectoryRefresh(req, res);
      case 'round-press-matchdetails-backfill': return await handleRoundPressMatchDetailsBackfill(req, res);
      case 'manifest': return res.status(200).json(manifest());
      default: return res.status(404).json({ error: 'Unknown testing tool.' });
    }
  } catch (error) {
    console.error(`Forge testing tool failed: ${tool}`, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'CHPP testing tool failed.' });
  }
}
