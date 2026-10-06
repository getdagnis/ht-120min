'use client';

import type { ReactNode } from 'react';
import { CalendarBlank, Trophy } from 'phosphor-react';
import { TeamsIcon } from '../Icons/TeamsIcon';
import {
  getCurrentRoundNumber,
  getTournamentCardDateLabel,
  getTournamentCardDescription,
  getTournamentStateLabel,
  type TournamentCardSummary,
} from '../../utils/tournament-card-details';
import styles from './TournamentCardContent.module.sass';

export function TournamentCardContent({
  tournament,
  trailing,
}: {
  tournament: TournamentCardSummary;
  trailing?: ReactNode;
}) {
  const hasRounds = (tournament.rounds || []).length > 0;
  const isOngoing =
    hasRounds &&
    tournament.status !== 'paused' &&
    tournament.status !== 'finished' &&
    tournament.completedMatches < tournament.totalMatches;
  const description = getTournamentCardDescription(tournament.description);
  return (
    <div className={styles.body}>
      <div className={styles.titleRow}>
        <div className={styles.heading}>
          <h3 className={styles.name}>{tournament.name}</h3>
          <span className={`${styles.state} ${isOngoing ? styles.stateOngoing : ''}`}>
            {getTournamentStateLabel(tournament)}
          </span>
        </div>
        {trailing}
      </div>
      <div className={styles.meta}>
        <span>
          <TeamsIcon size={14} />{' '}
          {tournament.max_teams != null && tournament.max_teams > 0
            ? `${tournament.teamCount}/${tournament.max_teams}`
            : tournament.teamCount}{' '}
          teams
        </span>
        <span>
          <Trophy size={14} weight="regular" />
          {hasRounds && (
            <>
              Round {getCurrentRoundNumber(tournament)}/{tournament.totalRounds}
            </>
          )}
        </span>
        <span>
          <CalendarBlank size={14} weight="regular" /> {getTournamentCardDateLabel(tournament)}
        </span>
      </div>
      {description && <p className={styles.description}>{description}</p>}
    </div>
  );
}
