import React from 'react';
import { resolveCountryRestriction } from '../../../shared/worlddetails';
import styles from './TournamentBadgeChips.module.sass';

interface TournamentBadgeChipsProps {
  countryLimit?: string | null;
  leagueCategory?: string | null;
  scoringMode?: string | null;
  children?: React.ReactNode;
}

export const TournamentBadgeChips: React.FC<TournamentBadgeChipsProps> = ({
  countryLimit,
  leagueCategory,
  scoringMode,
  children,
}) => {
  const countryRestriction = resolveCountryRestriction(countryLimit);
  const is120min = scoringMode === '120min' || scoringMode === '120m';

  if (!countryRestriction && leagueCategory !== 'hfi' && !is120min && !children) return null;

  return (
    <div className={styles.badges}>
      {countryRestriction && (
        <div className={styles.badge}>
          <img
            src={`https://www.hattrick.org/Img/flags/${countryRestriction.leagueId}.png`}
            alt=""
            className={styles.flag}
          />
          {countryRestriction.leagueName} Only
        </div>
      )}
      {leagueCategory === 'hfi' && (
        <div className={styles.badge}>
          <img src="https://www.hattrick.org/Img/flags/3000.png" alt="" className={styles.flag} /> HFI 💃🏽
        </div>
      )}
      {is120min && <div className={styles.badge}>⏱ 120min</div>}
      {children}
    </div>
  );
};
