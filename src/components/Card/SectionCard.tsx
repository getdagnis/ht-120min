import React from 'react';
import { CaretDown, CaretUp } from 'phosphor-react';
import styles from './SectionCard.module.sass';

interface SectionCardProps {
  children: React.ReactNode;
  title?: string | React.ReactElement;
  subtitle?: string | React.ReactElement;
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
  subtitle,
  headerRight,
  className = '',
  collapsible = false,
  isCollapsed = false,
  onToggleCollapse,
  headerThumbnailIndex,
}) => {
  return (
    <div className={`${styles.card} ${className} ${collapsible ? styles.collapsible : ''}`}>
      {title && (
        <div className={styles.header} onClick={collapsible ? onToggleCollapse : undefined}>
          <div className={styles.headerLeft}>
            {headerThumbnailIndex && (
              <div className={styles.headerThumbnail}>
                <img src={`/thumbs/thumb-${headerThumbnailIndex}.png`} alt="" />
              </div>
            )}
            <h3 className={styles.title}>{title}</h3> {subtitle}
          </div>
          {headerRight}
          {collapsible && (
            <button className={styles.collapseBtn} type="button">
              {isCollapsed ? <CaretDown size={20} weight="bold" /> : <CaretUp size={20} weight="bold" />}
            </button>
          )}
        </div>
      )}
      {!isCollapsed && <div className={styles.content}>{children}</div>}
    </div>
  );
};
