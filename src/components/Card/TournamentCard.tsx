import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'phosphor-react';
import styles from './TournamentCard.module.sass';
import { getTournamentBackgroundStyle } from '../../utils/visuals';
import { TournamentBadgeChips } from '../TournamentBadgeChips/TournamentBadgeChips';
import type { CountryRestrictionFormat } from '../../../shared/worlddetails';

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
  countryLimitFormat?: CountryRestrictionFormat | null;
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
  countryLimitFormat,
  scoringMode,
  leagueCategory,
  teamCount,
  maxTeams,
  joinHref,
}) => {
  const bgStyle = getTournamentBackgroundStyle(id, imageUrl);
  const isFull = maxTeams != null && (teamCount ?? 0) >= maxTeams;

  return (
    <div className={`${styles.card} ${className}`}>
      <div className={styles.thumbnailWrapper} style={bgStyle}>
        {isActiveInviting && <div className={styles.invitingBadge}>Actively Inviting</div>}
      </div>
      <div className={styles.mainContent}>
        {children}
        <TournamentBadgeChips
          countryLimit={countryLimit}
          countryLimitFormat={countryLimitFormat}
          leagueCategory={leagueCategory}
          scoringMode={scoringMode}
        >
          {maxTeams != null && (
            <div className={`${styles.badge} ${isFull ? styles.badgeFull : ''}`}>
              {isFull ? `${teamCount ?? 0}/${maxTeams} — Full` : `${teamCount ?? 0}/${maxTeams} teams`}
            </div>
          )}
          {joinHref && (
            <Link href={joinHref} className={styles.joinLink}>
              Join <ArrowRight size={12} weight="bold" />
            </Link>
          )}
        </TournamentBadgeChips>
      </div>
    </div>
  );
};
