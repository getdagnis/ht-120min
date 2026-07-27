'use client';

import dynamic from 'next/dynamic';
import type { Locale } from '../i18n/config';

const LegacyPublicApp = dynamic(
  () => import('./LegacyPublicApp').then((module) => module.LegacyPublicApp),
  { ssr: false },
);

export function LegacyPublicRoute({ locale }: { locale: Locale }) {
  return <LegacyPublicApp locale={locale} />;
}
