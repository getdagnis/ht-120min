import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchManagerTeamsFromChpp } from '../../_lib/matchmaker.js';
import { getSupabase } from '../../_lib/supabase.js';

export interface ManagerCredentialAudit {
  requestedManagerId: number;
  hasUserTokens: boolean;
  tokenSource: 'profiles' | 'teams' | 'none';
  profileHasTokens: boolean;
  teamFallbackHasTokens: boolean;
  chppSyncedAt: string | null;
  tokenPreview: string | null;
  managerNameStored: string | null;
  oauthScope: string | null;
  hasManageChallengesScope: boolean;
  chppVerifiedUserId: number | null;
  chppVerifiedManagerName: string | null;
  identityMatches: boolean;
  teamsFromChpp: Array<{ teamId: number; teamName: string }>;
  chppLiveCallOk: boolean;
  chppLiveCallError: string | null;
}

export async function auditManagerCredentials(
  managerId: number,
  supabase: SupabaseClient = getSupabase(),
): Promise<ManagerCredentialAudit> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('hattrick_user_id, manager_name, oauth_token, oauth_token_secret, oauth_scope, chpp_synced_at, teams_json')
    .eq('hattrick_user_id', managerId)
    .maybeSingle();

  const { data: teamRow } = await supabase
    .from('teams')
    .select('hattrick_user_id, manager_name, oauth_token, oauth_token_secret')
    .eq('hattrick_user_id', managerId)
    .not('oauth_token', 'is', null)
    .order('active', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const profileHasTokens = !!(profile?.oauth_token && profile?.oauth_token_secret);
  const teamFallbackHasTokens = !!(teamRow?.oauth_token && teamRow?.oauth_token_secret);

  let tokenSource: ManagerCredentialAudit['tokenSource'] = 'none';
  let oauthToken: string | null = null;
  let oauthTokenSecret: string | null = null;
  let managerNameStored: string | null = profile?.manager_name ?? null;

  if (profileHasTokens) {
    tokenSource = 'profiles';
    oauthToken = profile!.oauth_token!;
    oauthTokenSecret = profile!.oauth_token_secret!;
  } else if (teamFallbackHasTokens) {
    tokenSource = 'teams';
    oauthToken = teamRow!.oauth_token!;
    oauthTokenSecret = teamRow!.oauth_token_secret!;
    managerNameStored = teamRow!.manager_name ?? managerNameStored;
  }

  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;

  let chppVerifiedUserId: number | null = null;
  let chppVerifiedManagerName: string | null = null;
  let teamsFromChpp: Array<{ teamId: number; teamName: string }> = [];
  let chppLiveCallOk = false;
  let chppLiveCallError: string | null = null;

  if (oauthToken && oauthTokenSecret && consumerKey && consumerSecret) {
    try {
      const snapshot = await fetchManagerTeamsFromChpp(
        consumerKey,
        consumerSecret,
        {
          oauth_token: oauthToken,
          oauth_token_secret: oauthTokenSecret,
        },
        managerId,
      );

      chppVerifiedUserId = snapshot.hattrickUserId;
      chppVerifiedManagerName = snapshot.managerName;
      teamsFromChpp = snapshot.teams.map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
      }));
      chppLiveCallOk = true;
    } catch (error) {
      chppLiveCallError = error instanceof Error ? error.message : 'managercompendium failed';
    }
  } else if (!consumerKey || !consumerSecret) {
    chppLiveCallError = 'CHPP consumer key/secret missing in environment';
  } else {
    chppLiveCallError = 'No user oauth_token/oauth_token_secret in database';
  }

  return {
    requestedManagerId: managerId,
    hasUserTokens: tokenSource !== 'none',
    tokenSource,
    profileHasTokens,
    teamFallbackHasTokens,
    chppSyncedAt: profile?.chpp_synced_at ?? null,
    tokenPreview: oauthToken ? `${oauthToken.slice(0, 8)}…` : null,
    managerNameStored,
    oauthScope: profile?.oauth_scope ?? null,
    hasManageChallengesScope: typeof profile?.oauth_scope === 'string' && profile.oauth_scope.includes('manage_challenges'),
    chppVerifiedUserId,
    chppVerifiedManagerName,
    identityMatches: chppVerifiedUserId !== null && Number(chppVerifiedUserId) === Number(managerId),
    teamsFromChpp,
    chppLiveCallOk,
    chppLiveCallError,
  };
}

export const TESTING_AUTH_EXPLANATION = {
  summary:
    '/testing does NOT use browser cookies or your incognito session. It loads oauth_token + oauth_token_secret from Supabase for the managerId you pass in the URL.',
  chppSigning:
    'Every CHPP call uses THREE parts: CHPP_CONSUMER_KEY/SECRET (app) + oauth_token/oauth_token_secret (user, from DB). App credentials alone cannot act as a specific manager.',
  securityNote:
    'Anyone who knows a managerId can hit /testing while dev mode is on and use stored tokens from the database. This is a dev tool, not user authentication.',
  ifViewWorks:
    'If challenges-view returns your team data, user tokens ARE stored and CHPP accepted them for that manager. challengeable 401 is then likely scope or parameter related, not missing login.',
  ifNoTokens:
    'If credentials-check shows hasUserTokens=false, log in via /api/auth/init while logged into Hattrick, then re-run credentials-check.',
  manageChallengesScope:
    'OAuth init does not yet persist granted scopes. You may need to authorize manage_challenges on Hattrick and re-login. Use oauth-verify after login.',
};
