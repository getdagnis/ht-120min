import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import Script from 'next/script';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Layout } from '../../../components/Layout/Layout';
import { ScrollToTop } from '../../../components/ScrollToTop';
import { barlow, barlowCondensed, ibmPlexMono, notoColorEmoji } from '../../../fonts';
import { LocaleProvider } from '../../../i18n/LocaleProvider';
import { locales, isLocale, type Locale } from '../../../i18n/config';
import { getAppSessionSecret, verifyAppSessionCookie } from '../../../server/api/_lib/app-session';
import '../../../global.sass';

const themeBootstrapScript = `
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
    }
  } catch {}
`;

export const dynamic = 'force-dynamic';

function getAnalyticsExcludedUserId() {
  const userId = Number(process.env.ANALYTICS_EXCLUDED_HT_USER_ID || '');
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

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
  const sessionToken = (await cookies()).get('ht_session')?.value;
  const sessionSecret = getAppSessionSecret();
  const session =
    sessionToken && sessionSecret ? verifyAppSessionCookie(`ht_session=${sessionToken}`, sessionSecret) : null;
  const excludeAnalytics = session?.userId === getAnalyticsExcludedUserId();

  return (
    <html
      className={`${barlow.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable} ${notoColorEmoji.variable}`}
      lang={locale}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <Script
          src="https://cdn.counter.dev/script.js"
          data-id="b00ddeff-7e76-4ab9-864b-fb21b6a22fa3"
          data-utcoffset="2"
          strategy="afterInteractive"
        />
        <div id="root">
          <LocaleProvider locale={locale}>
            <ScrollToTop />
            <Layout excludeAnalytics={excludeAnalytics}>{children}</Layout>
          </LocaleProvider>
        </div>
      </body>
    </html>
  );
}
