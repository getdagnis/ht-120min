import React from 'react';
import styles from './TournamentCard.module.sass';

interface TournamentCardProps {
  children: React.ReactNode;
  className?: string;
  thumbnailIndex?: number;
  imageUrl?: string;
}

export const TournamentCard: React.FC<TournamentCardProps> = ({
  children,
  className = '',
  thumbnailIndex,
  imageUrl,
}) => {
  return (
    <div className={`${styles.card} ${className}`}>
      {(thumbnailIndex !== undefined || imageUrl) && (
        <div className={styles.thumbnailWrapper}>
          <img
            src={imageUrl ? imageUrl : `/thumbs/thumb-${thumbnailIndex}.png`}
            alt=""
            className={styles.thumbnail}
          />
        </div>
      )}
      <div className={styles.mainContent}>{children}</div>
    </div>
  );
};
