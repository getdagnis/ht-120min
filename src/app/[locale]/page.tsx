import { notFound } from 'next/navigation';
import { isLocale } from '../../i18n/config';
import { HomePublicApp } from '../../next/HomePublicApp';
import { loadHomeInitialData } from '../_data/public-data';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const initialHomeData = await loadHomeInitialData();
  return <HomePublicApp locale={locale} initialData={initialHomeData} />;
}
