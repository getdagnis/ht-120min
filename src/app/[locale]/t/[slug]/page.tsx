import { notFound } from 'next/navigation';
import { isLocale } from '../../../../i18n/config';
import { TournamentPublicApp } from '../../../../next/TournamentPublicApp';
import { loadTournamentInitialData } from '../../../_data/public-data';

export const dynamic = 'force-dynamic';

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  let initialTournamentData;
  try {
    initialTournamentData = await loadTournamentInitialData(slug);
  } catch (error) {
    console.error('Could not load tournament data on the server:', error instanceof Error ? error.message : 'Unknown error');
    initialTournamentData = undefined;
  }
  if (initialTournamentData === null) notFound();

  return <TournamentPublicApp locale={locale} slug={slug} initialData={initialTournamentData} />;
}
