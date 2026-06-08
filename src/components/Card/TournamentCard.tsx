import React from 'react';
import styles from './TournamentCard.module.sass';

interface TournamentCardProps {
  children: React.ReactNode;
  className?: string;
  thumbnailIndex?: number;
  imageUrl?: string;
  isActiveInviting?: boolean;
  scoringSystem?: string;
  matchesPlayed?: number;
  nextMatch?: string;
}

export const TournamentCard: React.FC<TournamentCardProps> = ({
  children,
  className = '',
  thumbnailIndex,
  imageUrl,
  isActiveInviting = false,
  scoringSystem,
  matchesPlayed,
  nextMatch,
}) => {
  const bgImage = imageUrl ? imageUrl : `/thumbs/thumb-${thumbnailIndex}.png`;
  return (
    <div className={`${styles.card} ${className}`}>
      {(thumbnailIndex !== undefined || imageUrl) && (
        <div 
          className={styles.thumbnailWrapper}
          style={{ backgroundImage: `url(${bgImage})` }}
        >
          {isActiveInviting && <div className={styles.invitingBadge}>Actively Inviting</div>}
        </div>
      )}
      <div className={styles.mainContent}>
        {children}
        <div className={styles.meta}>
          <span>{scoringSystem}</span>
          <span>{matchesPlayed} matches</span>
          {nextMatch && <span>Next: {nextMatch}</span>}
        </div>
      </div>
    </div>
  );
};
