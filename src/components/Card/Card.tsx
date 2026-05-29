import React from 'react';
import styles from './Card.module.scss';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  variant?: 'classic' | 'hero' | 'classy';
}

export const Card: React.FC<CardProps> = ({ children, title, className = '', variant = 'classic' }) => {
  return (
    <div className={`${styles.card} ${styles[variant]} ${className}`}>
      {title && <h3 className={styles.title}>{title}</h3>}
      <div className={styles.content}>{children}</div>
    </div>
  );
};
