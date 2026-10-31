import { useTranslations } from 'next-intl';
import React from 'react';
import { ArrowRight } from 'phosphor-react';
import styles from './StandingsRoundPreview.module.sass';

export interface StandingsPreviewMatch {
  id: string;
  home_team_id?: string | null;
  away_team_id?: string | null;
  match_type?: number | null;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120?: boolean;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  home_team: { name: string; ht_team_id: number } | null;
  away_team: { name: string; ht_team_id: number } | null;
}

export interface StandingsPreviewRound {
  id: string;
  round_number: number;
  phase?: 'regular' | 'postseason' | null;
  phase_status?: 'pending' | 'materialized' | 'completed';
  is_unscored?: boolean;
  matches: StandingsPreviewMatch[];
}

interface StandingsRoundPreviewProps {
  rounds: StandingsPreviewRound[];
  seasonStatus?: 'planned' | 'ongoing' | 'finished';
  onVisitFixtures?: () => void;
  myHtTeamIds?: ReadonlySet<number>;
}

const HATTRICK_TEAM_URL = 'https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=';

const isFinishedMatch = (match: StandingsPreviewMatch) => match.completed || match.status === 'misarranged';

const renderTeam = (team: StandingsPreviewMatch['home_team'], isRight: boolean, isOwnTeam: boolean, byeLabel: string) => {
  if (!team) return <span className={styles.bye}>{byeLabel}</span>;

  const teamClassName = [isRight ? styles.teamRight : null, isOwnTeam ? styles.teamOwn : null]
    .filter(Boolean)
    .join(' ');

  return (
    <a
      href={`${HATTRICK_TEAM_URL}${team.ht_team_id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={teamClassName || undefined}
    >
      {team.name}
    </a>
  );
};

const RoundPanel: React.FC<{
  label: string;
  round: StandingsPreviewRound;
  isLastRound: boolean;
  onVisitFixtures?: () => void;
  myHtTeamIds: ReadonlySet<number>;
}> = ({ label, round, isLastRound, onVisitFixtures, myHtTeamIds }) => {
  const uiText = useTranslations('PublicUI.StandingsRoundPreview');
  const headingId = isLastRound ? 'standings-last-round' : 'standings-next-round';
  const visibleMatches = round.matches.length > 6
    ? round.matches.filter((match) =>
        Boolean(
          (match.home_team && myHtTeamIds.has(match.home_team.ht_team_id)) ||
          (match.away_team && myHtTeamIds.has(match.away_team.ht_team_id)),
        ),
      )
    : round.matches;
  return <section className={styles.panel} aria-labelledby={headingId}>
    <div className={styles.panelHeader}>
      <h3 id={headingId}>
        {label} <span>{uiText('roundNumber', { round: round.round_number })}</span>
      </h3>
      {!isLastRound && onVisitFixtures && (
        <button type="button" className={styles.fullFixturesLink} onClick={onVisitFixtures}>
          {uiText('fullFixtures')} <ArrowRight size={15} weight="bold" aria-hidden="true" />
        </button>
      )}
    </div>
    <div className={styles.matches}>
      {visibleMatches.length === 0 ? (
        <p className={styles.emptyRound}>{uiText('noTeamMatches')}</p>
      ) : visibleMatches.map((match) => {
        const matchResult = match.completed
          ? `${match.home_goals ?? 0} - ${match.away_goals ?? 0}`
          : match.status === 'misarranged'
            ? 'DNP'
            : '–';

        return (
          <div className={styles.match} key={match.id}>
            <div>
              {renderTeam(
                match.home_team,
                false,
                Boolean(match.home_team && myHtTeamIds.has(match.home_team.ht_team_id)),
                uiText('bye'),
              )}
            </div>
            <span className={styles.resultStack}>
              <span className={styles.result}>{isLastRound ? matchResult : '–'}</span>
              {isLastRound && match.went_120 === true && (
                <span className={styles.minutesChip} title={uiText('minutesAchieved')}>
                  {uiText('minutesShort')}
                </span>
              )}
            </span>
            <div>
              {renderTeam(
                match.away_team,
                true,
                Boolean(match.away_team && myHtTeamIds.has(match.away_team.ht_team_id)),
                uiText('bye'),
              )}
            </div>
          </div>
        );
      })}
    </div>
  </section>;
};

export const StandingsRoundPreview: React.FC<StandingsRoundPreviewProps> = ({
  rounds,
  seasonStatus,
  onVisitFixtures,
  myHtTeamIds = new Set<number>(),
}) => {
  const uiText = useTranslations('PublicUI.StandingsRoundPreview');
  if ((seasonStatus !== 'ongoing' && seasonStatus !== 'finished') || rounds.length === 0) return null;

  const countedRounds = rounds.filter(round => !round.is_unscored);
  const lastRound = [...countedRounds]
    .reverse()
    .find((round) => round.matches.length > 0 && round.matches.every(isFinishedMatch));
  const nextRound = countedRounds.find((round) => round.matches.some((match) => !isFinishedMatch(match)));

  if (!lastRound && !nextRound) return null;

  return (
    <div className={styles.preview}>
      {lastRound && (
        <RoundPanel
          label={uiText('lastRound')}
          round={lastRound}
          isLastRound
          onVisitFixtures={onVisitFixtures}
          myHtTeamIds={myHtTeamIds}
        />
      )}
      {nextRound && (
        <RoundPanel
          label={uiText('nextRound')}
          round={nextRound}
          isLastRound={false}
          onVisitFixtures={onVisitFixtures}
          myHtTeamIds={myHtTeamIds}
        />
      )}
    </div>
  );
};
