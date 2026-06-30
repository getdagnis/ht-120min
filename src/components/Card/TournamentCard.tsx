import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'phosphor-react';
import styles from './TournamentCard.module.sass';
import { getLeagueIdByName } from '../../utils/leagues';
import { getTournamentBackgroundStyle } from '../../utils/visuals';

interface TournamentCardProps {
  id: string;
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
  teamCount?: number;
  maxTeams?: number | null;
  joinHref?: string;
}

export const TournamentCard: React.FC<TournamentCardProps> = ({
  id,
  children,
  className = '',
  imageUrl,
  isActiveInviting = false,
  countryLimit,
  scoringMode,
  leagueCategory,
  teamCount,
  maxTeams,
  joinHref,
}) => {
  const navigate = useNavigate();
  const bgStyle = getTournamentBackgroundStyle(id, imageUrl);
  const countryId = countryLimit ? getLeagueIdByName(countryLimit) : undefined;
  const isFull = maxTeams != null && (teamCount ?? 0) >= maxTeams;

  return (
    <div className={`${styles.card} ${className}`}>
      <div className={styles.thumbnailWrapper} style={bgStyle}>
        {isActiveInviting && <div className={styles.invitingBadge}>Actively Inviting</div>}
      </div>
      <div className={styles.mainContent}>
        {children}
        <div className={styles.badges}>
          {countryLimit && (
            <div className={styles.badge}>
              {countryId && (
                <img src={`https://www.hattrick.org/Img/flags/${countryId}.png`} alt="" className={styles.flag} />
              )}
              {countryLimit} Only
            </div>
          )}
          {leagueCategory === 'hfi' && (
            <div className={styles.badge}>
              <img src={`https://www.hattrick.org/Img/flags/3000.png`} alt="" className={styles.flag} /> HFI 💃🏽
            </div>
          )}
          {scoringMode === '120min' && <div className={styles.badge}>120-min</div>}
          {maxTeams != null && (
            <div className={`${styles.badge} ${isFull ? styles.badgeFull : ''}`}>
              {isFull ? `${teamCount ?? 0}/${maxTeams} — Complete!` : `${teamCount ?? 0}/${maxTeams} teams`}
            </div>
          )}
          {joinHref && (
            <button type="button" className={styles.joinLink} onClick={() => navigate(joinHref)}>
              Join <ArrowRight size={12} weight="bold" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
