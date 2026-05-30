import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import styles from './Card.module.scss';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  variant?: 'classic' | 'hero' | 'classy';
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  className = '',
  variant = 'classic',
  collapsible = false,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  return (
    <div className={`${styles.card} ${styles[variant]} ${className} ${collapsible ? styles.collapsible : ''}`}>
      {title && (
        <div className={styles.header} onClick={collapsible ? onToggleCollapse : undefined}>
          <h3 className={styles.title}>{title}</h3>
          {collapsible && (
            <button className={styles.collapseBtn} type="button">
              {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
            </button>
          )}
        </div>
      )}
      {!isCollapsed && <div className={styles.content}>{children}</div>}
    </div>
  );
};
