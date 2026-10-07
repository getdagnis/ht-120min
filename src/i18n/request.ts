import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale } from './config';
import { dictionaries } from './get-dictionary';

export default getRequestConfig(async ({ requestLocale }) => {
  const requestedLocale = await requestLocale;
  const locale = isLocale(requestedLocale ?? '') ? requestedLocale : defaultLocale;
  return { locale, messages: dictionaries[locale] };
});
