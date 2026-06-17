import React from 'react';
import { Card } from '../Card/Card';
import { Button } from '../Button/Button';
import styles from './BeerBanner.module.sass';

export const BeerBanner: React.FC = () => {
  const handleTip = () => {
    window.open('https://buymeacoffee.com/dagnis', '_blank');
  };

  return (
    <Card className={styles.beerCard}>
      <div className={styles.bannerImageWrapper} />
      <div className={styles.content}>
        <div className={styles.left}>
          <h2 className={styles.title}>Give the dev a beer!</h2>
          <p className={styles.subtitle}>
            Programming boring stuff requires coffee. Programming fun stuff demands beer! Save the fun, give dev a beer!
          </p>
          <Button variant="secondaryYellow" size="md" className={styles.tipBtn} onClick={handleTip}>
            Tip me a pint! <span className={styles.btnBeer}>🍺</span>
          </Button>
        </div>
        <div className={styles.right}>
          <img src="/bmc_qr.png" alt="Buy me a beer QR" className={styles.qrCode} />
        </div>
      </div>
    </Card>
  );
};
