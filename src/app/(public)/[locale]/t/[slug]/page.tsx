import { notFound } from 'next/navigation';
import { isLocale } from '../../../../../i18n/config';
import { TournamentView } from '../../../../../legacy-pages/Public/TournamentView';
import { loadTournamentInitialData } from '../../../../_data/public-data';

export const dynamic = 'force-dynamic';

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  let initialData;
  try {
    initialData = await loadTournamentInitialData(slug);
  } catch (error) {
    console.error('Could not load tournament data on the server:', error instanceof Error ? error.message : 'Unknown error');
    initialData = undefined;
  }
  if (initialData === null) notFound();

  return <TournamentView initialData={initialData} />;
}
