import { useTranslations } from 'next-intl';
import { Card } from '../Card/Card';
import { Button } from '../Button/Button';
import styles from './BeerBanner.module.sass';

interface BeerBannerProps {
  variant?: 'default' | 'tinder';
}

export const BeerBanner: React.FC<BeerBannerProps> = ({ variant = 'default' }) => {
  const t = useTranslations('common');
  const handleTip = () => {
    window.open('https://buymeacoffee.com/dagnis', '_blank');
  };

  return (
    <Card className={[styles.beerCard, variant === 'tinder' ? styles.tinderBeerCard : ''].filter(Boolean).join(' ')}>
      <div className={styles.bannerImageWrapper} />
      <div className={styles.content}>
        <div className={styles.left}>
          <h2 className={styles.title}>{t('beerBannerTitle')}</h2>
          <p className={styles.subtitle}>{t('beerBannerDescription')}</p>
          <Button
            variant={variant === 'tinder' ? 'tinder' : 'secondaryYellow'}
            size="md"
            className={styles.tipBtn}
            onClick={handleTip}
          >
            {t('tipDevBeer')}
            <span className={styles.btnBeer}>🍺</span>
          </Button>
        </div>
        <div className={styles.right}>
          <a href="https://buymeacoffee.com/dagnis" target="_blank">
            <img src="/bmc_qr.png" alt={t('buyMeBeerQrAlt')} className={styles.qrCode} />
          </a>
        </div>
      </div>
    </Card>
  );
};
