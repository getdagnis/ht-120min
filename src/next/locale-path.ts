import { defaultLocale, isLocale, type Locale } from '../i18n/config';

export function toLocalePath(locale: Locale | string, path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/api')) return path;
  if (path === `/${locale}` || path.startsWith(`/${locale}/`)) return path;
  return `/${locale}${path === '/' ? '' : path}`;
}

export function withCurrentLocale(path: string) {
  const currentLocale = typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : defaultLocale;
  const locale = isLocale(currentLocale) ? currentLocale : defaultLocale;
  return toLocalePath(locale, path);
}
