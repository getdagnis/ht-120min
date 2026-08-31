import React, { useEffect, useRef } from 'react';
import { Card } from '../Card/Card';
import { Button } from '../Button/Button';
import styles from './BeerBanner.module.sass';

interface BeerBannerProps {
  variant?: 'default' | 'tinder';
}

const getalus_imgUrls: string[] = [
  '/getalus/getalus-cc-1.png',
  '/getalus/getalus-cc-2.png',
  '/getalus/getalus-cc-3.png',
  '/getalus/getalus-cc-4.png',
  '/getalus/getalus-cc-5.png',
  '/getalus/getalus-cc-6.png',
  '/getalus/getalus-cc-7.png',
];
const getalus_labels: string[] = ["Tip Dev a beer!"];

export const BeerBanner: React.FC<BeerBannerProps> = ({ variant = 'default' }) => {
  const bannerImageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nextIndex = Math.floor(Math.random() * getalus_imgUrls.length);

    const nextImageUrl = getalus_imgUrls[nextIndex];
    if (bannerImageRef.current) {
      bannerImageRef.current.dataset.getalusImages = nextImageUrl;
      bannerImageRef.current.style.backgroundImage = `url('${nextImageUrl}')`;
    }
  }, []);

  const handleTip = () => {
    window.open('https://buymeacoffee.com/dagnis', '_blank');
  };

  return (
    <Card className={[styles.beerCard, variant === 'tinder' ? styles.tinderBeerCard : ''].filter(Boolean).join(' ')}>
      <div
        ref={bannerImageRef}
        className={styles.bannerImageWrapper}
        data-getalus-images={getalus_imgUrls[0]}
        style={{ backgroundImage: `url('${getalus_imgUrls[0]}')` }}
      />
      <div className={styles.content}>
        <div className={styles.left}>
          <h2 className={styles.title}>Keep the features coming!</h2>
          <p className={styles.subtitle}>
            Programming boring stuff requires coffee, programming cool stuff demands beer. Fuel the cool stuff!
          </p>
          <Button variant={variant === 'tinder' ? 'tinder' : 'secondaryYellow'} size="md" className={styles.tipBtn} onClick={handleTip}>
            {getalus_labels[0]}<span className={styles.btnBeer}>🍺</span>
          </Button>
        </div>
        <div className={styles.right}>
          <a href='https://buymeacoffee.com/dagnis' target='_blank'><img src="/bmc_qr.png" alt="Buy me a beer QR" className={styles.qrCode} /></a>
        </div>
      </div>
    </Card>
  );
};
