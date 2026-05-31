import React from 'react';
import { ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import styles from './Card.module.scss';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  variant?: 'classic' | 'hero' | 'classy';
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  thumbnailIndex?: number;
  headerThumbnailIndex?: number;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  className = '',
  variant = 'classic',
  collapsible = false,
  isCollapsed = false,
  onToggleCollapse,
  thumbnailIndex,
  headerThumbnailIndex,
}) => {
  return (
    <div
      className={`${styles.card} ${styles[variant]} ${className} ${collapsible ? styles.collapsible : ''} ${thumbnailIndex ? styles.withThumbnail : ''}`}
    >
      {thumbnailIndex && (
        <div className={styles.thumbnailWrapper}>
          <img src={`/thumbs/thumb-${thumbnailIndex}.png`} alt="" className={styles.thumbnail} />
        </div>
      )}
      <div className={styles.mainContent}>
        {title && (
          <div className={styles.header} onClick={collapsible ? onToggleCollapse : undefined}>
            <div className={styles.headerLeft}>
              {headerThumbnailIndex && (
                <div className={styles.headerThumbnail}>
                  <img src={`/thumbs/thumb-${headerThumbnailIndex}.png`} alt="" />
                </div>
              )}
              <h3 className={styles.title}>{title}</h3>
            </div>
            {collapsible && (
              <button className={styles.collapseBtn} type="button">
                {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
              </button>
            )}
          </div>
        )}
        {!isCollapsed && <div className={styles.content}>{children}</div>}
      </div>
    </div>
  );
};
