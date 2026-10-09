import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Layout } from '../../../components/Layout/Layout';
import { PublicDataUnavailable } from '../../../components/PublicDataUnavailable/PublicDataUnavailable';
import { ScrollToTop } from '../../../components/ScrollToTop';
import { barlow, barlowCondensed, ibmPlexMono, notoColorEmoji } from '../../../fonts';
import { LocaleProvider } from '../../../i18n/LocaleProvider';
import { locales, isLocale, type Locale } from '../../../i18n/config';
import { canPreviewLocale, loadPublicLocaleSettings } from '../../../i18n/server-catalog';
import type { Dictionary } from '../../../i18n/get-dictionary';
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

  const requestHeaders = await headers();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ht-120min.vercel.app';
  const { options: publicLocales } = await loadPublicLocaleSettings();
  const preview = requestHeaders.get('x-locale-preview') === '1'
    || !publicLocales.some((item) => item.locale === rawLocale);
  return {
    title: 'HT-120min',
    description: 'The easiest way to organize recurring Hattrick friendlies.',
    robots: preview ? { index: false, follow: false } : undefined,
    alternates: {
      canonical: `${siteUrl}/${rawLocale}`,
      languages: Object.fromEntries(publicLocales.map((item) => [item.locale, `${siteUrl}/${item.locale}`])),
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
  const requestHeaders = await headers();
  setRequestLocale(locale);
  const [messages, localeSettings] = await Promise.all([getMessages(), loadPublicLocaleSettings()]);
  const availableLocales = localeSettings.options;
  if (localeSettings.available && !availableLocales.some((option) => option.locale === locale)
    && !(await canPreviewLocale(locale, requestHeaders.get('x-locale-preview'), requestHeaders.get('cookie')))) notFound();
  const cookieStore = await cookies();
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
          <LocaleProvider locale={locale} messages={messages as Dictionary} availableLocales={availableLocales}>
            <NextIntlClientProvider locale={locale} messages={messages}>
              <ScrollToTop />
              <Layout excludeAnalytics={excludeAnalytics}>
                {!localeSettings.available && locale !== 'en' ? <PublicDataUnavailable /> : children}
              </Layout>
            </NextIntlClientProvider>
          </LocaleProvider>
        </div>
      </body>
    </html>
  );
}
