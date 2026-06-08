import React from 'react';
import { Card } from '../Card/Card';
import { Quotes } from 'phosphor-react';
import { useRandomCycle } from '../../hooks/useRandomCycle';
import { DESCRIPTIONS } from '../../constants/descriptions';
import styles from './MottoWidget.module.sass';

interface MottoWidgetProps {
  items?: string[];
  intervalMs?: number;
  className?: string;
  theme?: 'light' | 'dark';
}

export const MottoWidget: React.FC<MottoWidgetProps> = ({
  items = DESCRIPTIONS,
  intervalMs = 8000,
  className = '',
  theme = 'light',
}) => {
  const currentMotto = useRandomCycle(items, intervalMs);

  return (
    <Card className={`${styles.mottoCard} ${className} ${theme === 'dark' ? styles.darkTheme : ''}`}>
      <div className={styles.mottoContent}>
        <Quotes size={32} weight="bold" className={styles.quoteIcon} />
        <p className={styles.mottoText}>{currentMotto}</p>
      </div>
    </Card>
  );
};
