import React from 'react';
import { Card } from '../Card/Card';
import { Lineicons } from '@lineiconshq/react-lineicons';
import { DoubleQuotesEnd1Outlined } from '@lineiconshq/free-icons';
import { useRandomCycle } from '../../hooks/useRandomCycle';
import { DESCRIPTIONS } from '../../constants/descriptions';
import styles from './MottoWidget.module.sass';

interface MottoWidgetProps {
  items?: string[];
  intervalMs?: number;
  className?: string;
}

export const MottoWidget: React.FC<MottoWidgetProps> = ({
  items = DESCRIPTIONS,
  intervalMs = 8000,
  className = '',
}) => {
  const currentMotto = useRandomCycle(items, intervalMs);

  return (
    <Card variant="classic" className={`${styles.mottoCard} ${className}`}>
      <div className={styles.mottoContent}>
        <Lineicons icon={DoubleQuotesEnd1Outlined} size={20} className={styles.quoteIcon} />
        <p className={styles.mottoText}>{currentMotto}</p>
      </div>
    </Card>
  );
};
