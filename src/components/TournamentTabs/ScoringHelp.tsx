'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info, X } from 'phosphor-react';
import { isAppg120ScoringMode, isAverage120ScoringMode } from '../../../shared/scoring-profile';
import styles from '../../legacy-pages/Public/TournamentView.module.sass';

interface ScoringHelpProps {
  scoringMode?: string | null;
  className?: string;
}

export const ScoringHelp: React.FC<ScoringHelpProps> = ({ scoringMode, className }) => {
  const uiText = useTranslations('PublicUI.TournamentView');
  const [isExpanded, setIsExpanded] = useState(false);
  const isAppgMode = isAppg120ScoringMode(scoringMode);
  const isAverage120Mode = isAverage120ScoringMode(scoringMode);
  const is120minMode = scoringMode === '120m' || scoringMode === '120min';

  return (
    <div className={`${styles.scoringHelp}${className ? ` ${className}` : ''}`}>
      {isAppgMode ? (
        <>
          <p onClick={() => setIsExpanded(!isExpanded)} className={styles.helpToggle}>
            <strong>{uiText('aPPG120ScoringMode')}</strong>{' '}
            {isExpanded ? <X size={18} /> : <Info size={18} />}
          </p>
          {isExpanded && (
            <div className={styles.helpContent}>
              <p>
                <strong>{uiText('aPPG120')}</strong> {uiText('usesAveragePointsPerGameWithTheEnglishTournament')}
              </p>
              <ul>
                <li>
                  <strong>{uiText('eT3')}</strong> {uiText('3PointsForFinishingTheMatchInExtraTime')}
                </li>
                <li>
                  <strong>{uiText('eT2')}</strong> {uiText('2PointsForFinishingTheMatchInExtraTime')}
                </li>
                <li>
                  <strong>{uiText('pS1')}</strong> {uiText('1PointIfTheMatchGoesToPenalties')}
                </li>
                <li>
                  <strong>{uiText('rT0')}</strong> {uiText('0PointsIfTheMatchIsDecidedBeforeExtra')}
                </li>
                <li>
                  <strong>{uiText('oPW')}</strong> {uiText('minus1PointForTheWinningTeamAfterA')}
                </li>
              </ul>
              <p>
                {uiText('clearRegulationTimeEventEvidenceIsClassifiedAutomaticallyAs')}{' '}
                <strong>{uiText('needsReview')}</strong> {uiText('untilAnOrganizerClassifiesThem')}
              </p>
            </div>
          )}
        </>
      ) : isAverage120Mode ? (
        <>
          <p onClick={() => setIsExpanded(!isExpanded)} className={styles.helpToggle}>
            <strong>{uiText('average120ScoringMode')}</strong>{' '}
            {isExpanded ? <X size={18} /> : <Info size={18} />}
          </p>
          {isExpanded && <p className={styles.helpContent}>{uiText('average120ScoringExplanation')}</p>}
        </>
      ) : is120minMode ? (
        <>
          <p onClick={() => setIsExpanded(!isExpanded)} className={styles.helpToggle}>
            <strong>{uiText('120minScoringMode')}</strong>{' '}
            {isExpanded ? <X size={18} /> : <Info size={18} />}
          </p>
          {isExpanded && (
            <p className={styles.helpContent}>
              {uiText('teamsAreRankedFirstBy')} <strong>{uiText('120minAchievements')}</strong>
              {uiText('thenPointsGoalDifferenceGoalsScoredAndFinallyFewer')}
            </p>
          )}
        </>
      ) : (
        <>
          <p onClick={() => setIsExpanded(!isExpanded)} className={styles.helpToggle}>
            <strong>{uiText('victoryPointsMode')}</strong>{' '}
            {isExpanded ? <X size={18} /> : <Info size={18} />}
          </p>
          {isExpanded && (
            <p className={styles.helpContent}>
              {uiText('standardCompetitiveTournamentTeamsEarn3PointsForA')}{' '}
              <strong>{uiText('totalPoints')}</strong>
              {uiText('thenGoalDifferenceAndGoalsScored120minGamesMean')}
            </p>
          )}
        </>
      )}
    </div>
  );
};
