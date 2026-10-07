import React from 'react';
import { CaretDown, CaretUp } from 'phosphor-react';
import styles from './SectionCard.module.sass';
import { getHeaderThumbnailStyle } from '../../utils/visuals';

interface SectionCardProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  variant?: 'grass';
  highlighted?: boolean;
  className?: string;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  headerThumbnailIndex?: number;
  thumbnailSeed?: string;
  thumbnailImageUrl?: string | null;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  children,
  title,
  subtitle,
  headerRight,
  variant,
  highlighted = false,
  className,
  collapsible = false,
  isCollapsed = false,
  onToggleCollapse,
  headerThumbnailIndex,
  thumbnailSeed,
  thumbnailImageUrl,
}) => {
  const thumbStyle = thumbnailSeed ? getHeaderThumbnailStyle(thumbnailSeed, thumbnailImageUrl) : null;

  return (
    <div
      className={`${styles.card} ${highlighted ? styles.highlighted : ''} ${className} ${variant === 'grass' ? styles.grass : ''} ${collapsible ? styles.collapsible : ''}`}
    >
      {title && (
        <div
          className={`${styles.header}  ${variant === 'grass' ? styles.grass : ''}`}
          onClick={collapsible ? onToggleCollapse : undefined}
        >
          <div className={styles.headerLeft}>
            {thumbnailSeed && <div className={styles.headerThumbnail} style={thumbStyle || undefined} />}
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
