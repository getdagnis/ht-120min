import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { isLocale } from '../../../i18n/config';
import { Home } from '../../../legacy-pages/Home/Home';
import { loadHomeInitialData } from '../../_data/public-data';
import { PublicDataUnavailable } from '../../../components/PublicDataUnavailable/PublicDataUnavailable';
import { readHomePageData } from '../../../utils/public-page-data';
import { parsePublicDataAttempt } from '../../../utils/public-data-config.js';
import { FundraiserCampaign } from '../../../components/Fundraiser/FundraiserCampaign';
import { SupportedThankYou } from '../../../components/Fundraiser/SupportedThankYou';
import { FUNDRAISER_STATUS, fundraiserProduct } from '../../../../shared/fundraiser';

export const dynamic = 'auto';

export async function generateMetadata({
  params, searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ fundraiser?: string }>;
}): Promise<Metadata> {
  const [{ locale }, { fundraiser }] = await Promise.all([params, searchParams]);
  if (fundraiser !== '1' || !isLocale(locale)) return {};
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ht-120min.vercel.app';
  return {
    title: 'Should HT-120 last another season?',
    description: 'Put some fuel back in HT-120min. Every beer helps keep the project going.',
    alternates: { canonical: `${siteUrl}/${locale}/fundraiser` },
  };
}

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ publicDataAttempt?: string; fundraiser?: string; supported?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { publicDataAttempt: attemptParam, fundraiser, supported } = await searchParams;
  if (supported !== undefined) {
    if (!fundraiserProduct(supported)) notFound();
    return <SupportedThankYou item={supported} />;
  }
  if (fundraiser === '1') {
    if (FUNDRAISER_STATUS === 'hidden') notFound();
    return <FundraiserCampaign />;
  }
  const attempt = parsePublicDataAttempt(attemptParam);

  const result = await readHomePageData(() => loadHomeInitialData(attempt));
  if (result.status === 'unavailable') {
    console.error('Could not load Home public data:', result.error instanceof Error ? result.error.message : 'Unknown error');
    return <PublicDataUnavailable attempt={attempt} retryHref={`/${locale}`} />;
  }
  return <Home initialData={result.data} />;
}
