'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale } from './LocaleProvider';
import { locales } from './config';

export function LocaleSwitcher() {
  const { locale, messages } = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathWithoutLocale = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), '') || '/';
  const query = searchParams.toString();

  return (
    <nav aria-label={messages.common.language}>
      {locales.map((targetLocale) => (
        <Link
          key={targetLocale}
          href={`/${targetLocale}${pathWithoutLocale}${query ? `?${query}` : ''}`}
          aria-current={targetLocale === locale ? 'page' : undefined}
        >
          {targetLocale === 'en' ? messages.common.english : messages.common.latvian}
        </Link>
      ))}
    </nav>
  );
}
