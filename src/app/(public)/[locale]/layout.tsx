import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Layout } from '../../../components/Layout/Layout';
import { ScrollToTop } from '../../../components/ScrollToTop';
import { barlow, barlowCondensed, ibmPlexMono, notoColorEmoji } from '../../../fonts';
import { LocaleProvider } from '../../../i18n/LocaleProvider';
import { locales, isLocale, type Locale } from '../../../i18n/config';
import { getAppSessionSecret, verifyAppSessionCookie } from '../../../server/api/_lib/app-session';
import { getAnalyticsExcludedHtUserId, isLocalAnalyticsHost } from '../../../server/api/_lib/analytics';
import { getForgeSuperadminId, verifyForgeSessionCookie } from '../../../server/api/_lib/forge-session';
import '../../../global.sass';

const themeBootstrapScript = `
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
    }
  } catch {}
`;

// cookies() keeps this shell request-specific without disabling the Home Data Cache.
export const dynamic = 'auto';

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
  setRequestLocale(locale);
  const messages = await getMessages();
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie') || '';
  const sessionToken = cookieStore.get('ht_session')?.value;
  const sessionSecret = getAppSessionSecret();
  const session =
    sessionToken && sessionSecret ? verifyAppSessionCookie(`ht_session=${sessionToken}`, sessionSecret) : null;
  const excludedUserIds = [getAnalyticsExcludedHtUserId(), getForgeSuperadminId()].filter((id): id is number => Boolean(id));
  const excludeAnalytics = isLocalAnalyticsHost(requestHeaders.get('host') || undefined)
    || Boolean(verifyForgeSessionCookie(cookieHeader))
    || Boolean(session && excludedUserIds.includes(session.userId));

  return (
    <html
      className={`${barlow.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable} ${notoColorEmoji.variable}`}
      lang={locale}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <div id="root">
          <LocaleProvider locale={locale}>
            <NextIntlClientProvider locale={locale} messages={messages}>
              <ScrollToTop />
              <Layout excludeAnalytics={excludeAnalytics}>{children}</Layout>
            </NextIntlClientProvider>
          </LocaleProvider>
        </div>
      </body>
    </html>
  );
}
