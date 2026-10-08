'use client';

import { SectionCard } from '../../../components/Card/SectionCard';
import { useTranslations } from 'next-intl';

// A shared boundary lets Next prefetch the shell and commit navigation immediately.
// Public data is cached separately; identity and live observations stay dynamic.
export default function PublicPageLoading() {
  const t = useTranslations('common');

  return (
    <SectionCard title={t('loadingPage')} className="mt-12 mb-12">
      <p role="status" aria-live="polite">
        {t('gettingTournamentInformation')}
      </p>
    </SectionCard>
  );
}
