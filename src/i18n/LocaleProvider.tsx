'use client';

/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Locale } from './config';
import { type Dictionary } from './get-dictionary';
import type { LocaleMenuOption } from './catalog';

interface LocaleContextValue {
  locale: Locale;
  messages: Dictionary;
  availableLocales: LocaleMenuOption[];
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ locale, messages, availableLocales, children }: {
  locale: Locale; messages: Dictionary; availableLocales: LocaleMenuOption[]; children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, messages, availableLocales }), [locale, messages, availableLocales]);

  useEffect(() => {
    document.cookie = `ht120_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}
