import { notFound } from 'next/navigation';
import { isLocale } from '../../../../../i18n/config';
import { loadHomeInitialData } from '../../../../_data/public-data';
import { CollectionView } from './CollectionView';
import { PublicDataUnavailable } from '../../../../../components/PublicDataUnavailable/PublicDataUnavailable';
import { readCollectionPageData } from '../../../../../utils/public-page-data';
import { parsePublicDataAttempt } from '../../../../../utils/public-data-config.js';

export const dynamic = 'auto';

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ publicDataAttempt?: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const { publicDataAttempt: attemptParam } = await searchParams;
  const attempt = parsePublicDataAttempt(attemptParam);
  const result = await readCollectionPageData(() => loadHomeInitialData(attempt), slug);
  if (result.status === 'not-found') notFound();
  if (result.status === 'unavailable') {
    console.error('Could not load collection public data:', result.error instanceof Error ? result.error.message : 'Unknown error');
    return <PublicDataUnavailable attempt={attempt} retryHref={`/${locale}/collection/${slug}`} />;
  }
  return <CollectionView collection={result.data} locale={locale} />;
}
