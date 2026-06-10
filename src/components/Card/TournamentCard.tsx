import React from 'react';
import styles from './TournamentCard.module.sass';
import { getLeagueIdByName } from '../../utils/leagues';

interface TournamentCardProps {
  children: React.ReactNode;
  className?: string;
  thumbnailIndex?: number;
  imageUrl?: string;
  isActiveInviting?: boolean;
  scoringSystem?: string;
  matchesPlayed?: number;
  nextMatch?: string;
  countryLimit?: string | null;
  scoringMode?: string | null;
  leagueCategory?: string | null;
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
  countryLimit,
  scoringMode,
  leagueCategory,
}) => {
  const bgImage = imageUrl ? imageUrl : `/thumbs/thumb-${thumbnailIndex}.png`;
  const countryId = countryLimit ? getLeagueIdByName(countryLimit) : undefined;

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
        <div className={styles.badges}>
           {countryLimit && (
             <div className={styles.badge}>
               {countryId && <img src={`https://www.hattrick.org/Img/flags/${countryId}.png`} alt="" className={styles.flag} />}
               {countryLimit}
             </div>
           )}
           {leagueCategory === 'hfi' && (
             <div className={styles.badge}>HFI</div>
           )}
           {scoringMode === '120min' && <div className={styles.badge}>120 min</div>}
        </div>
        <div className={styles.meta}>
          <span>{scoringSystem}</span>
          <span>{matchesPlayed} matches</span>
          {nextMatch && <span>Next: {nextMatch}</span>}
        </div>
      </div>
    </div>
  );
};

