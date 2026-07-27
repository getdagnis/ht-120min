import React from 'react';
import styles from './HeroCard.module.sass';

interface HeroCardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export const HeroCard: React.FC<HeroCardProps> = ({ children, className = '', title }) => {
  return (
    <div className={`${styles.card} ${className}`}>
      {title && <h3 className={styles.title}>{title}</h3>}
      <div className={styles.content}>{children}</div>
    </div>
  );
};
