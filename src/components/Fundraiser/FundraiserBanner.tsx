'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FUNDRAISER_STATUS } from '../../../shared/fundraiser';
import { Button } from '../Button/Button';
import styles from './FundraiserModal.module.sass';

const BANNER_KEY = 'ht120_fundraiser_banner_hidden';

export function FundraiserBanner({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('Fundraiser');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (FUNDRAISER_STATUS !== 'active') return;
    const timer = window.setTimeout(() => setVisible(localStorage.getItem(BANNER_KEY) !== 'true'), 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible || FUNDRAISER_STATUS !== 'active') return null;

  return <aside className={styles.banner}>
    <div className={styles.bannerCopy}>
      <strong>{t('bannerTitle')}</strong>
      <p>{t('bannerDescription')}</p>
    </div>
    <Button type="button" variant="secondaryYellow" size="sm" onClick={onOpen}>
      {t('openFundraiser')}
    </Button>
    <button type="button" className={styles.dismiss} aria-label={t('dismissBanner')}
      onClick={() => { localStorage.setItem(BANNER_KEY, 'true'); setVisible(false); }}>×</button>
  </aside>;
}
