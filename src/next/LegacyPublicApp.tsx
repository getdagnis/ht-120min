'use client';

import App from '../App';
import type { Locale } from '../i18n/config';

export function LegacyPublicApp({ locale }: { locale: Locale }) {
  return <App basename={`/${locale}`} />;
}
