import React from 'react';
import { Lineicons } from '@lineiconshq/react-lineicons';
import { ChevronDownOutlined, ChevronUpOutlined } from '@lineiconshq/free-icons';
import styles from './Card.module.sass';

interface CardProps {
  children: React.ReactNode;
  title?: string | React.ReactElement;
  className?: string;
  variant?: 'classic' | 'hero' | 'classy';
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  thumbnailIndex?: number;
  headerThumbnailIndex?: number;
  imageUrl?: string;
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
  imageUrl,
}) => {
  return (
    <div
      className={`${styles.card} ${styles[variant]} ${className} ${collapsible ? styles.collapsible : ''} ${thumbnailIndex || imageUrl ? styles.withThumbnail : ''}`}
    >
      {(thumbnailIndex || imageUrl) && (
        <div className={styles.thumbnailWrapper}>
          <img src={imageUrl ? imageUrl : `/thumbs/thumb-${thumbnailIndex}.png`} alt="" className={styles.thumbnail} />
        </div>
      )}
      <div className={styles.mainContent}>
        {title && (
          <div className={styles.header} onClick={collapsible ? onToggleCollapse : undefined}>
            <div className={styles.headerLeft}>
              <h3 className={styles.title}>{title}</h3>
            </div>
            {collapsible && (
              <button className={styles.collapseBtn} type="button">
                {isCollapsed ? (
                  <Lineicons icon={ChevronDownOutlined} size={20} />
                ) : (
                  <Lineicons icon={ChevronUpOutlined} size={20} />
                )}
              </button>
            )}
          </div>
        )}
        {!isCollapsed && <div className={styles.content}>{children}</div>}
      </div>
    </div>
  );
};
