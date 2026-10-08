'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarBlank, Trophy } from 'phosphor-react';
import { TeamsIcon } from '../Icons/TeamsIcon';
import {
  getCurrentRoundNumber,
  getTournamentCardDate,
  getTournamentCardDescription,
  getTournamentState,
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
  const t = useTranslations('Home');
  const locale = useLocale();
  const state = getTournamentState(tournament);
  const currentRoundNumber = getCurrentRoundNumber(tournament);
  const cardDate = getTournamentCardDate(tournament);
  const date = new Intl.DateTimeFormat(locale === 'lv' ? 'lv-LV' : 'en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Riga',
  }).format(new Date(cardDate.value));
  const stateLabel = state === 'finished'
    ? t('tournamentCardFinished', { season: tournament.season })
    : state === 'paused'
      ? t('tournamentCardPaused', { season: tournament.season })
      : state === 'ongoing'
        ? t(currentRoundNumber !== null && currentRoundNumber <= 2
          ? 'tournamentCardStarted'
          : 'tournamentCardOngoing', { season: tournament.season })
        : t('tournamentCardWaiting', { season: tournament.season });
  const dateLabel = cardDate.kind === 'finished'
    ? t('tournamentCardFinishedDate', { date })
    : cardDate.kind === 'started'
      ? t('tournamentCardStartedDate', { date })
      : t('tournamentCardPlannedDate', { date });
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
            {stateLabel}
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
          {t('tournamentCardTeams')}
        </span>
        <span>
          <Trophy size={14} weight="regular" />
          {hasRounds && (
            <>
              {t('tournamentCardRound', {
                current: getCurrentRoundNumber(tournament) ?? '',
                total: tournament.totalRounds,
              })}
            </>
          )}
        </span>
        <span>
          <CalendarBlank size={14} weight="regular" />
          {dateLabel}
        </span>
      </div>
      {description && <p className={styles.description}>{description}</p>}
    </div>
  );
}
