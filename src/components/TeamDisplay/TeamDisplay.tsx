import React from 'react';
import { getFlagUrl } from '../../utils/ht-data';
import { getLeagueNameById } from '../../utils/leagues';
import styles from './TeamDisplay.module.scss';

interface TeamDisplayProps {
  team?: {
    name: string;
    ht_team_id?: number | string;
    logo_url?: string;
    country_name?: string;
    country_id?: number | null;
  } | null;
  side?: 'home' | 'away';
}

export const TeamDisplay: React.FC<TeamDisplayProps> = ({ team, side }) => {
  const isFree = !team?.name;
  const countryName = getLeagueNameById(team?.country_id) || team?.country_name;
  const flagUrl = getFlagUrl(countryName);

  return (
    <div className={`${styles.teamDisplay} ${side ? styles[side] : ''}`}>
      <div className={styles.logoRow}>
        {team?.logo_url && (
          <img src={team.logo_url} alt={team.name} className={styles.logo} />
        )}
        {flagUrl && (
          <img src={flagUrl} alt="" className={styles.flag} title={countryName} />
        )}
      </div>
      {team?.name ? (
        <span className={styles.teamName}>{team.name}</span>
      ) : (
        <span className={styles.teamNameFree}>Free to choose</span>
      )}

      {team?.ht_team_id ? (
        <span className={styles.teamId}>({team.ht_team_id})</span>
      ) : (
        <span className={styles.teamId}>{isFree ? '(no tournament opponent)' : ''}</span>
      )}
    </div>
  );
};
