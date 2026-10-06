import { notFound } from 'next/navigation';
import { isLocale } from '../../../../../i18n/config';
import { loadHomeInitialData } from '../../../../_data/public-data';
import { CollectionView } from './CollectionView';

export const dynamic = 'auto';

export default async function CollectionPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const collections = (await loadHomeInitialData()).collections;
  const collection = Array.isArray(collections) ? collections.find((item) => item.slug === slug) : undefined;
  if (!collection) notFound();
  return <CollectionView collection={collection} locale={locale} />;
}
