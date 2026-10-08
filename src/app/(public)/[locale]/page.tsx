import { notFound } from 'next/navigation';
import { isLocale } from '../../../i18n/config';
import { Home } from '../../../legacy-pages/Home/Home';
import { loadHomeInitialData } from '../../_data/public-data';
import { PublicDataUnavailable } from '../../../components/PublicDataUnavailable/PublicDataUnavailable';
import { readHomePageData } from '../../../utils/public-page-data';
import { parsePublicDataAttempt } from '../../../utils/public-data-config.js';

export const dynamic = 'auto';

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ publicDataAttempt?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { publicDataAttempt: attemptParam } = await searchParams;
  const attempt = parsePublicDataAttempt(attemptParam);

  const result = await readHomePageData(() => loadHomeInitialData(attempt));
  if (result.status === 'unavailable') {
    console.error('Could not load Home public data:', result.error instanceof Error ? result.error.message : 'Unknown error');
    return <PublicDataUnavailable attempt={attempt} retryHref={`/${locale}`} />;
  }
  return <Home initialData={result.data} />;
}
