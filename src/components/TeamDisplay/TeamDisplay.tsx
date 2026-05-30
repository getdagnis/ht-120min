import React from 'react';
import styles from './TeamDisplay.module.scss';

interface TeamDisplayProps {
  team?: {
    name: string;
    ht_team_id?: number | string;
    logo_url?: string;
  } | null;
  side?: 'home' | 'away';
}

export const TeamDisplay: React.FC<TeamDisplayProps> = ({ team, side }) => {
  const isFree = !team?.name;

  return (
    <div className={`${styles.teamDisplay} ${side ? styles[side] : ''}`}>
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
