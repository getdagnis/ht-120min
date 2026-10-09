import { getRequestConfig } from 'next-intl/server';
import { headers } from 'next/headers';
import { defaultLocale, isLocale } from './config';
import { canPreviewLocale, loadRuntimeDictionary } from './server-catalog';

export default getRequestConfig(async ({ requestLocale }) => {
  const requestedLocale = await requestLocale;
  const locale = requestedLocale && isLocale(requestedLocale) ? requestedLocale : defaultLocale;
  const requestHeaders = await headers();
  const preview = await canPreviewLocale(locale, requestHeaders.get('x-locale-preview'), requestHeaders.get('cookie'));
  return { locale, messages: await loadRuntimeDictionary(locale, preview) };
});
