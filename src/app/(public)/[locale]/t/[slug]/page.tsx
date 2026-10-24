import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { isLocale } from '../../../../../i18n/config';
import { TournamentView } from '../../../../../legacy-pages/Public/TournamentView';
import { loadHomeInitialData, loadTournamentInitialData } from '../../../../_data/public-data';
import { readPublicTournament } from '../../../../../utils/public-tournament-load';
import { getAppSessionSecret, verifyAppSessionCookie } from '../../../../../server/api/_lib/app-session';
import { getForgeSuperadminId } from '../../../../../server/api/_lib/forge-session';
import { getServiceSupabase } from '../../../../../server/api/_lib/supabase';
import { isHfiTeam } from '../../../../../utils/team-eligibility';

type SurveyTeam = { id: string; name: string; logo_url?: string };
type ProfileTeam = {
  teamId: number;
  teamName: string;
  logoUrl?: string;
  leagueName?: string;
  leagueId?: number;
  leagueSystemId?: number;
  genderId?: number;
};

function isProfileTeam(value: unknown): value is ProfileTeam {
  if (!value || typeof value !== 'object') return false;
  const team = value as Record<string, unknown>;
  return Number.isInteger(team.teamId) && Number(team.teamId) > 0
    && typeof team.teamName === 'string' && team.teamName.trim().length > 0;
}

async function loadSurveyTestTeams(): Promise<SurveyTeam[]> {
  if (process.env.survey_test !== 'true' && process.env.SURVEY_TEST !== 'true') return [];
  const adminId = getForgeSuperadminId();
  const secret = getAppSessionSecret();
  if (!adminId || !secret) return [];
  const sessionToken = (await cookies()).get('ht_session')?.value;
  const session = sessionToken ? verifyAppSessionCookie(`ht_session=${sessionToken}`, secret) : null;
  if (session?.userId !== adminId) return [];

  try {
    const { data, error } = await getServiceSupabase(6000)
      .from('profiles')
      .select('teams_json')
      .eq('hattrick_user_id', session.userId)
      .maybeSingle();
    if (error) throw error;
    const teams = Array.isArray(data?.teams_json) ? data.teams_json.filter(isProfileTeam) : [];
    const regular = teams.find((team) => !isHfiTeam(team));
    const hfi = teams.find(isHfiTeam);
    return [regular, hfi]
      .filter((team): team is ProfileTeam => Boolean(team))
      .map((team) => ({ id: String(team.teamId), name: team.teamName, logo_url: team.logoUrl }));
  } catch (error) {
    console.error('Could not load survey test teams:', error instanceof Error ? error.message : error);
    return [];
  }
}

// The locale shell reads cookies, so HTML remains request-specific. Allow the
// explicit public Data Cache instead of forcing every read to bypass it.
export const dynamic = 'auto';

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  const tournamentResult = await readPublicTournament(() => loadTournamentInitialData(slug));
  if (tournamentResult.status === 'not-found') notFound();
  const initialData = tournamentResult.status === 'loaded' ? tournamentResult.data : undefined;
  if (tournamentResult.status === 'failed') {
    console.error('Could not load tournament data on the server:', tournamentResult.error);
  }
  let collectionLinks: { slug: string; title: string }[] = [];
  if (initialData) {
    try {
      collectionLinks = (await loadHomeInitialData()).collections
        .filter((collection) => collection.members.some((member) => member.tournament.id === initialData.tournament.id))
        .map((collection) => ({ slug: collection.slug, title: collection.title }));
    } catch (error) {
      console.error('Could not load tournament collection links:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
  const defaultTheme = initialData?.tournament.default_theme;
  const surveyTestTeams = await loadSurveyTestTeams();
  // Fixed enum values only; apply the default before the tournament HTML paints.
  const themeScript = defaultTheme === 'light' || defaultTheme === 'dark'
    ? `document.documentElement.dataset.tournamentTheme='${defaultTheme}';document.documentElement.dataset.theme='${defaultTheme}';`
    : null;
  return <>
    {themeScript && <script dangerouslySetInnerHTML={{ __html: themeScript }} />}
    <TournamentView key={slug} initialData={initialData} collectionLinks={collectionLinks} surveyTestTeams={surveyTestTeams} />
  </>;
}
