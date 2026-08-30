'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Globe } from 'phosphor-react';
import { useLocale } from './LocaleProvider';
import { locales } from './config';
import styles from './LocaleSwitcher.module.sass';

const localeFlags = {
  en: '🇬🇧',
  lv: '🇱🇻',
} as const;

export function LocaleSwitcher() {
  const { locale, messages } = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const switcherRef = useRef<HTMLElement>(null);
  const pathWithoutLocale = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), '') || '/';
  const query = searchParams.toString();

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <nav ref={switcherRef} className={styles.switcher} aria-label={messages.common.language}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Globe size={20} weight="regular" aria-hidden="true" />
        <span>{locale.toUpperCase()}</span>
      </button>

      {isOpen && (
        <div className={styles.menu} role="menu">
          {locales.map((targetLocale) => (
            <Link
              key={targetLocale}
              href={`/${targetLocale}${pathWithoutLocale}${query ? `?${query}` : ''}`}
              className={styles.item}
              aria-current={targetLocale === locale ? 'page' : undefined}
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              <span className={styles.flag} aria-hidden="true">
                {localeFlags[targetLocale]}
              </span>
              <span>{targetLocale === 'en' ? messages.common.english : messages.common.latvian}</span>
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
