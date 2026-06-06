import React from 'react';
import { Lineicons } from '@lineiconshq/react-lineicons';
import { ChevronDownOutlined, ChevronUpOutlined } from '@lineiconshq/free-icons';
import styles from './SectionCard.module.sass';

interface SectionCardProps {
  children: React.ReactNode;
  title?: string | React.ReactElement;
  headerRight?: string | React.ReactElement;
  className?: string;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  headerThumbnailIndex?: number;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  children,
  title,
  headerRight,
  className = '',
  collapsible = false,
  isCollapsed = false,
  onToggleCollapse,
  headerThumbnailIndex,
}) => {
  return (
    <div
      className={`${styles.card} ${className} ${collapsible ? styles.collapsible : ''}`}
    >
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
          {headerRight}
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
  );
};
