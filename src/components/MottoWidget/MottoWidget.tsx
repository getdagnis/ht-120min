import React from 'react';
import { Card } from '../Card/Card';
import { Quotes } from 'phosphor-react';
import { useLocale } from 'next-intl';
import { useRandomCycle } from '../../hooks/useRandomCycle';
import { getDescriptionPools } from '../../constants/description-pools';
import styles from './MottoWidget.module.sass';

interface MottoWidgetProps {
  items?: string[];
  intervalMs?: number;
  className?: string;
  theme?: 'light' | 'dark';
  variant?: 'default' | 'sidebar' | 'standings';
}

export const MottoWidget: React.FC<MottoWidgetProps> = ({
  items,
  intervalMs = 8000,
  className = '',
  theme = 'light',
  variant = 'default',
}) => {
  const locale = useLocale();
  const currentMotto = useRandomCycle(items ?? getDescriptionPools(locale).general, intervalMs);

  return (
    <Card
      className={`${styles.mottoCard} ${className} ${theme === 'dark' ? styles.darkTheme : ''} ${variant === 'sidebar' ? styles.sidebarVariant : variant === 'standings' ? styles.sidebarStandings : ''}`}
    >
      <div className={styles.mottoContent}>
        <Quotes size={28} className={styles.quoteIcon} />
        <p className={styles.mottoText}>{currentMotto}</p>
      </div>
    </Card>
  );
};
