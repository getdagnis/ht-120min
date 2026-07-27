import { defaultLocale, isLocale } from '../i18n/config';

export function withCurrentLocale(path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/api')) return path;
  const currentLocale = typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : defaultLocale;
  const locale = isLocale(currentLocale) ? currentLocale : defaultLocale;
  if (path === `/${locale}` || path.startsWith(`/${locale}/`)) return path;
  return `/${locale}${path === '/' ? '' : path}`;
}
