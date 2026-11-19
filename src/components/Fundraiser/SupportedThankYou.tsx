'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { fundraiserProduct, FUNDRAISER_SESSION_PROMPT_KEY } from '../../../shared/fundraiser';
import styles from './SupportedThankYou.module.sass';

export function SupportedThankYou({ item }: { item: string }) {
  const t = useTranslations('Fundraiser');
  const product = fundraiserProduct(item);

  useEffect(() => {
    if (!product || process.env.NODE_ENV === 'development') return;
    try { sessionStorage.setItem(FUNDRAISER_SESSION_PROMPT_KEY, 'true'); }
    catch { /* Storage can be disabled; the purchase match still runs. */ }
    const controller = new AbortController();
    void fetch('/api/app?route=fundraiser-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: product.key }),
      signal: controller.signal,
    }).catch(() => {
      // The thank-you remains visible if this optional name match cannot complete.
    });
    return () => controller.abort();
  }, [product]);

  const detail = product?.key === 'hfi' ? t('thanksHfi')
    : product?.key === 'flags' ? t('thanksFlags')
      : product?.key === '120min' ? t('thanks120min') : t('thanksGeneral');

  return <main className={styles.frame}>
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
        {detail}
        {product?.key === 'hfi' && <><br />{t('hfi.description')}</>}
      </p>
      <a href="/">{t('backHome')}</a>
    </div>
  </main>;
}
