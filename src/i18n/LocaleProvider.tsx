'use client';

/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Locale } from './config';
import { getDictionary, type Dictionary } from './get-dictionary';

interface LocaleContextValue {
  locale: Locale;
  messages: Dictionary;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages: getDictionary(locale) }), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.cookie = `ht120_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}
