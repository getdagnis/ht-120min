'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UsersThree } from 'phosphor-react';
import { fundraiserProduct, FUNDRAISER_SESSION_PROMPT_KEY, type FundraiserState } from '../../../shared/fundraiser';
import campaignStyles from './FundraiserCampaign.module.sass';
import styles from './SupportedThankYou.module.sass';
import Link from 'next/link';

export function SupportedThankYou({ item }: { item: string }) {
  const t = useTranslations('Fundraiser');
  const product = fundraiserProduct(item);
  const [state, setState] = useState<FundraiserState | null>(null);
  const [matchedManagerName, setMatchedManagerName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!product) return;
    const controller = new AbortController();
    const loadState = async () => {
      try {
        const response = await fetch('/api/app?route=fundraiser', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Fundraiser unavailable');
        const result = (await response.json()) as FundraiserState;
        if (!controller.signal.aborted) setState(result);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    };
    if (process.env.NODE_ENV === 'development') {
      void loadState();
      return () => controller.abort();
    }
    try {
      sessionStorage.setItem(FUNDRAISER_SESSION_PROMPT_KEY, 'true');
    } catch {
      /* Storage can be disabled; the purchase match still runs. */
    }
    void fetch('/api/app?route=fundraiser-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: product.key }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { matched?: boolean; managerName?: string };
        if (result.matched && result.managerName && !controller.signal.aborted) {
          setMatchedManagerName(result.managerName);
        }
      })
      .catch(() => {
        // The thank-you remains visible if this optional name match cannot complete.
      })
      .finally(() => {
        void loadState();
      });
    return () => controller.abort();
  }, [product]);

  const tankFill = state ? Math.min(5, Math.ceil(state.beers / 5)) : 1;

  return (
    <main className={styles.frame}>
      <div className={styles.paper} aria-hidden="true">
        <img src="/alus/support-modal-top.png" alt="" />
        <div className={styles.paperMiddle} />
        <img src="/alus/support-modal-bottom.png" alt="" />
      </div>
      <div className={styles.header} aria-hidden="true">
        <img src="/alus/thank-you.png" alt="" />
      </div>
      <div className={styles.message}>
        <h1>{t('thanksTitle')}</h1>
        <p>
          <strong>{product?.key === 'hfi' ? `${t('thanksHfi')} ` : ''}</strong>
          {t('thanksAllBefore')} <strong>{matchedManagerName ?? ''}</strong> {t('thanksAllAfter')}
        </p>
        <Link href="/">{t('backHome')}</Link>
      </div>
      <footer className={`${campaignStyles.footer} ${styles.footer}`}>
        <div>
          <strong>
            {t('total')} <span>{state?.beers ?? '…'} / 20!</span>
          </strong>
          <p>{t('thanksFuelNote')}</p>
        </div>
        <img
          className={styles.tank}
          src={tankFill === 0 ? '/alus/beer-tank-0c.png' : `/alus/beer-tank-${tankFill}of4.png`}
          alt=""
          aria-hidden="true"
        />
      </footer>
      {loadError && (
        <p className={styles.loadError} role="alert">
          {t('loadError')}
        </p>
      )}
    </main>
  );
}
