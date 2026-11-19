'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UsersThree } from 'phosphor-react';
import { emptyFundraiserProducts, FUNDRAISER_PRODUCTS, FUNDRAISER_STATUS, type FundraiserState } from '../../../shared/fundraiser';
import styles from './FundraiserCampaign.module.sass';

const CAMPAIGN_API = '/api/app?route=fundraiser';

function localPreviewState(): FundraiserState {
  return {
    status: FUNDRAISER_STATUS,
    beers: 0,
    hasSupported: false,
    products: emptyFundraiserProducts(),
  };
}

export function FundraiserCampaign({ variant = 'page' }: { variant?: 'page' | 'modal' }) {
  const t = useTranslations('Fundraiser');
  const [state, setState] = useState<FundraiserState | null>(null);
  const [error, setError] = useState<'load' | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const timer = window.setTimeout(() => setState(localPreviewState()), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    void fetch(CAMPAIGN_API, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unavailable');
        setState(await response.json() as FundraiserState);
      })
      .catch(() => { if (!controller.signal.aborted) setError('load'); });
    return () => controller.abort();
  }, []);

  const Container = variant === 'modal' ? 'div' : 'main';
  return (
    <Container className={`${styles.frame} ${variant === 'modal' ? styles.inModal : styles.page}`}>
      <div className={styles.paper} aria-hidden="true">
        <img src="/alus/support-modal-top.png" alt="" />
        <div className={styles.paperMiddle} />
        <img src="/alus/support-modal-bottom.png" alt="" />
      </div>
      <header className={styles.header}>
        <div className={styles.pumpWindow} aria-hidden="true">
          <img src="/alus/beer-pump-5x1-transparent.png" alt="" className={styles.pump} />
        </div>
        <h1><span>{t('titleLine1')}</span><br /><span>{t('titleLine2')}</span></h1>
      </header>
      <div className={styles.content}>
        <div className={styles.intro}>
          <h2>{t('fuelTitle')}</h2>
          <p>{t('fuelLead')} <strong>{t('fuelEmphasis')}</strong></p>
        </div>
        {error === 'load' && <p className={styles.message} role="alert">{t('loadError')}</p>}
        {!state && !error && <p className={styles.message} role="status">{t('loading')}</p>}
        {state && (
          <>
            <div className={styles.products}>
              {FUNDRAISER_PRODUCTS.map((product) => {
                const supporters = state.products[product.key].supporters;
                return (
                  <section className={styles.product} key={product.key}>
                    <img className={styles.badge} src={product.badge} alt="" />
                    <div className={styles.productCopy}>
                      <h3>{t(`${product.key}.title`)}</h3>
                      <p>{t(`${product.key}.description`)}</p>
                      {supporters.length > 0 && <p className={styles.supporters}>
                        <UsersThree size={15} weight="fill" aria-hidden="true" />{' '}
                        <strong>{t('supportedBy')}:</strong> {supporters.join(', ')}
                      </p>}
                    </div>
                    {state.status === 'active' && <a className={styles.purchase} href={product.url}
                      target="_blank" rel="noopener noreferrer"
                      aria-label={t('purchaseLabel', { product: t(`${product.key}.title`), price: product.price })}>
                      <img src={product.key === 'general' ? '/alus/support-btn-beer.png' : '/alus/support-btn-chipin5.png'}
                        alt={product.key === 'general' ? t('supportWithBeer') : t('chipInFive')} />
                    </a>}
                  </section>
                );
              })}
            </div>
            <footer className={styles.footer}>
              <strong>{t('total')} <span>{state.beers} / 20!</span></strong>
              <img src="/alus/beer-tank-0c.png" alt="" aria-hidden="true" />
            </footer>
          </>
        )}
      </div>
    </Container>
  );
}
