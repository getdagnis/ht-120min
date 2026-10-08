import { notFound } from 'next/navigation';
import { isLocale } from '../../../../../i18n/config';
import { TournamentView } from '../../../../../legacy-pages/Public/TournamentView';
import { loadHomeInitialData, loadTournamentInitialData } from '../../../../_data/public-data';
import { readPublicTournament } from '../../../../../utils/public-tournament-load';

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
    console.error('Could not load tournament data on the server:', tournamentResult.error instanceof Error ? tournamentResult.error.message : 'Unknown error');
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
  return <TournamentView key={slug} initialData={initialData} collectionLinks={collectionLinks} />;
}
