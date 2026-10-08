import { notFound } from 'next/navigation';
import { isLocale } from '../../../../../i18n/config';
import { loadHomeInitialData } from '../../../../_data/public-data';
import { CollectionView } from './CollectionView';
import { PublicDataUnavailable } from '../../../../../components/PublicDataUnavailable/PublicDataUnavailable';
import { readCollectionPageData } from '../../../../../utils/public-page-data';

export const dynamic = 'auto';

export default async function CollectionPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const result = await readCollectionPageData(loadHomeInitialData, slug);
  if (result.status === 'not-found') notFound();
  if (result.status === 'unavailable') {
    console.error('Could not load collection public data:', result.error instanceof Error ? result.error.message : 'Unknown error');
    return <PublicDataUnavailable retryHref={`/${locale}/collection/${slug}`} />;
  }
  return <CollectionView collection={result.data} locale={locale} />;
}
