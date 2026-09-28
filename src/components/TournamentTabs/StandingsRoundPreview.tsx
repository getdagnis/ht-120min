import React from 'react';
import { ArrowRight } from 'phosphor-react';
import styles from './StandingsRoundPreview.module.sass';

export interface StandingsPreviewMatch {
  id: string;
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

const renderTeam = (team: StandingsPreviewMatch['home_team'], isRight: boolean, isOwnTeam: boolean) => {
  if (!team) return <span className={styles.bye}>BYE</span>;

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
  label: 'Last round' | 'Next round';
  round: StandingsPreviewRound;
  isLastRound: boolean;
  onVisitFixtures?: () => void;
  myHtTeamIds: ReadonlySet<number>;
}> = ({ label, round, isLastRound, onVisitFixtures, myHtTeamIds }) => (
  <section className={styles.panel} aria-labelledby={`standings-${label.toLowerCase().replace(' ', '-')}`}>
    <div className={styles.panelHeader}>
      <h3 id={`standings-${label.toLowerCase().replace(' ', '-')}`}>
        {label} <span>Round {round.round_number}</span>
      </h3>
      {!isLastRound && onVisitFixtures && (
        <button type="button" className={styles.fullFixturesLink} onClick={onVisitFixtures}>
          Full fixtures <ArrowRight size={15} weight="bold" aria-hidden="true" />
        </button>
      )}
    </div>
    <div className={styles.matches}>
      {round.matches.map((match) => {
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
              )}
            </div>
            <span className={styles.resultStack}>
              <span className={styles.result}>{isLastRound ? matchResult : '–'}</span>
              {isLastRound && match.went_120 === true && (
                <span className={styles.minutesChip} title="120 minutes achieved">
                  120m
                </span>
              )}
            </span>
            <div>
              {renderTeam(
                match.away_team,
                true,
                Boolean(match.away_team && myHtTeamIds.has(match.away_team.ht_team_id)),
              )}
            </div>
          </div>
        );
      })}
    </div>
  </section>
);

export const StandingsRoundPreview: React.FC<StandingsRoundPreviewProps> = ({
  rounds,
  seasonStatus,
  onVisitFixtures,
  myHtTeamIds = new Set<number>(),
}) => {
  if ((seasonStatus !== 'ongoing' && seasonStatus !== 'finished') || rounds.length === 0) return null;

  const lastRound = [...rounds]
    .reverse()
    .find((round) => round.matches.length > 0 && round.matches.every(isFinishedMatch));
  const nextRound = rounds.find((round) => round.matches.some((match) => !isFinishedMatch(match)));

  if (!lastRound && !nextRound) return null;

  return (
    <div className={styles.preview}>
      {lastRound && (
        <RoundPanel
          label="Last round"
          round={lastRound}
          isLastRound
          onVisitFixtures={onVisitFixtures}
          myHtTeamIds={myHtTeamIds}
        />
      )}
      {nextRound && (
        <RoundPanel
          label="Next round"
          round={nextRound}
          isLastRound={false}
          onVisitFixtures={onVisitFixtures}
          myHtTeamIds={myHtTeamIds}
        />
      )}
    </div>
  );
};
