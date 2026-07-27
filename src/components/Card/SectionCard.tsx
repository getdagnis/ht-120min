import React from 'react';
import { CaretDown, CaretUp } from 'phosphor-react';
import styles from './SectionCard.module.sass';
import { getHeaderThumbnailStyle } from '../../utils/visuals';

interface SectionCardProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  className?: string;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  headerThumbnailIndex?: number;
  thumbnailSeed?: string;
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
  thumbnailSeed,
}) => {
  const thumbStyle = thumbnailSeed ? getHeaderThumbnailStyle(thumbnailSeed) : null;

  return (
    <div className={`${styles.card} ${className} ${collapsible ? styles.collapsible : ''}`}>
      {title && (
        <div className={styles.header} onClick={collapsible ? onToggleCollapse : undefined}>
          <div className={styles.headerLeft}>
            {thumbnailSeed && (
              <div className={styles.headerThumbnail} style={thumbStyle || undefined} />
            )}
            {!thumbnailSeed && headerThumbnailIndex && (
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
