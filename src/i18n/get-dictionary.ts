import en from './messages/en';
import lv from './messages/lv';
import type { Locale } from './config';

export const dictionaries = {
  en,
  lv: mergeWithEnglishFallback(en, lv),
} as const;

function mergeWithEnglishFallback<T>(english: T, translated: unknown): T {
  if (typeof english === 'string') {
    return (typeof translated === 'string' && translated.trim() ? translated : english) as T;
  }

  if (english && typeof english === 'object' && !Array.isArray(english)) {
    const translatedRecord =
      translated && typeof translated === 'object' && !Array.isArray(translated)
        ? (translated as Record<string, unknown>)
        : {};
    const merged = Object.fromEntries(
      Object.entries(english).map(([key, value]) => [key, mergeWithEnglishFallback(value, translatedRecord[key])]),
    );
    return merged as T;
  }

  return (translated ?? english) as T;
}

export type Dictionary = typeof en;

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
