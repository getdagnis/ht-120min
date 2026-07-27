import en from './messages/en';
import lv from './messages/lv';
import type { Locale } from './config';

export const dictionaries = { en, lv } as const;

export type Dictionary = typeof en;

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
