/* eslint-disable react-refresh/only-export-components */

import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import { locales, isLocale, type Locale } from '../../i18n/config';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();

  return <LocaleProvider locale={rawLocale as Locale}>{children}</LocaleProvider>;
}
