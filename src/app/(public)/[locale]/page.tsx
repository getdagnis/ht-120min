import { notFound } from 'next/navigation';
import { isLocale } from '../../../i18n/config';
import { Home } from '../../../legacy-pages/Home/Home';
import { loadHomeInitialData } from '../../_data/public-data';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <Home initialData={await loadHomeInitialData()} />;
}
