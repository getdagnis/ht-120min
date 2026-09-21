import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Layout } from '../../../components/Layout/Layout';
import { ScrollToTop } from '../../../components/ScrollToTop';
import { barlow, barlowCondensed, ibmPlexMono, notoColorEmoji } from '../../../fonts';
import { LocaleProvider } from '../../../i18n/LocaleProvider';
import { locales, isLocale, type Locale } from '../../../i18n/config';
import '../../../global.sass';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) return {};

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ht-120min.vercel.app';
  return {
    title: 'HT-120min',
    description: 'The easiest way to organize recurring Hattrick friendlies.',
    alternates: {
      canonical: `${siteUrl}/${rawLocale}`,
      languages: {
        en: `${siteUrl}/en`,
        lv: `${siteUrl}/lv`,
      },
    },
  };
}

export default async function PublicLocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale as Locale;

  return (
    <html
      className={`${barlow.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable} ${notoColorEmoji.variable}`}
      lang={locale}
    >
      <body>
        <div id="root">
          <LocaleProvider locale={locale}>
            <ScrollToTop />
            <Layout>{children}</Layout>
          </LocaleProvider>
        </div>
      </body>
    </html>
  );
}
