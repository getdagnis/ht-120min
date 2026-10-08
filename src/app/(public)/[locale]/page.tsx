import { notFound } from 'next/navigation';
import { isLocale } from '../../../i18n/config';
import { Home } from '../../../legacy-pages/Home/Home';
import { loadHomeInitialData } from '../../_data/public-data';
import { PublicDataUnavailable } from '../../../components/PublicDataUnavailable/PublicDataUnavailable';
import { readHomePageData } from '../../../utils/public-page-data';

export const dynamic = 'auto';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const result = await readHomePageData(loadHomeInitialData);
  if (result.status === 'unavailable') {
    console.error('Could not load Home public data:', result.error instanceof Error ? result.error.message : 'Unknown error');
    return <PublicDataUnavailable retryHref={`/${locale}`} />;
  }
  return <Home initialData={result.data} />;
}
