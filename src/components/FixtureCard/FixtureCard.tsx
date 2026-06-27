import React from 'react';
import { ArrowUpRight, Info } from 'phosphor-react';
import { Tooltip } from 'react-tooltip';
import { TeamByline } from '../TeamByline/TeamByline';
import styles from './FixtureCard.module.sass';

interface TeamProps {
  name: string;
  managerName?: string;
  managerHtId?: number;
  htTeamId: number;
  logoUrl?: string;
  warning?: 'yellow' | 'red';
  countryName?: string;
  countryId?: number;
}

interface FixtureCardProps {
  homeTeam: TeamProps;
  awayTeam: TeamProps;
  status: 'arranged' | 'not_arranged' | 'ongoing' | 'misarranged' | 'finished';
  score?: { home: number; away: number };
  penaltyShootout?: { home: number; away: number } | null;
  date?: string;
  htMatchId?: number;
  matchType?: number;
  is120minMode?: boolean;
  scoring_mode?: string;
  went_120?: boolean;
  completed?: boolean;
}

const MATCH_TYPES: Record<number, { initials: string; description: string }> = {
  4: { initials: 'NF', description: "Normal 90' Friendly" },
  5: { initials: 'CR', description: 'Cup Rules Friendly' },
  8: { initials: 'IF', description: "International 90' Friendly" },
  9: { initials: 'ICR', description: 'International Cup Rules Friendly' },
};

export const FixtureCard: React.FC<FixtureCardProps> = ({
  homeTeam,
  awayTeam,
  status,
  score,
  penaltyShootout,
  date,
  htMatchId,
  matchType,
  is120minMode,
  went_120,
  completed,
}) => {
  const badgeContent = (
    <div className={`${styles.statusBadge} ${styles[status]}`}>
      {went_120 && <div className={styles.badge120}>120'!</div>}
      <div className={styles.badgeRight}>
        {status.replace('_', ' ').toUpperCase()}{' '}
        {['arranged', 'ongoing', 'finished'].includes(status) && (
          <ArrowUpRight size={16} weight="bold" className={styles.statusBadgeIcon} />
        )}
      </div>
    </div>
  );

  const hasPenaltyShootout = Boolean(
    penaltyShootout && penaltyShootout.home !== null && penaltyShootout.away !== null && went_120 && completed,
  );

  const matchTypeInfo = matchType ? { ...MATCH_TYPES[matchType] } : null;
  if (matchTypeInfo && matchType === 5 && completed && went_120) {
    matchTypeInfo.initials = hasPenaltyShootout ? '120m+PS' : '120m';
    matchTypeInfo.description = hasPenaltyShootout
      ? '120 Minute Cup Rules Match decided by penalty shootout'
      : '120 Minute Cup Rules Match';
  }

  const isWrongType = is120minMode && matchType && [4, 7].includes(matchType);

  const renderTeamInfo = (team: TeamProps, isRight?: boolean) => (
    <>
      <div className={styles.teamName}>{team.name.toUpperCase()}</div>
      <TeamByline
        countryName={team.countryName}
        countryId={team.countryId}
        teamId={team.htTeamId}
        managerName={team.managerName}
        managerHtId={team.managerHtId}
        mode="fixtures"
        isRight={isRight}
      />
      {team.warning && (
        <div className={styles.warningRow}>
          <img src="/warn-red.png" alt="Warning" className={styles.warnIcon} />
          <span className={styles.warn}>Warning issued!</span>
        </div>
      )}
    </>
  );

  return (
    <div className={styles.fixtureCard}>
      <div className={styles.teamContainer}>
        <div className={styles.logoWrapper}>
          <img src={homeTeam.logoUrl || '/hero-logo-2.png'} alt={homeTeam.name} className={styles.logo} />
        </div>
        <div className={styles.teamDetails}>{renderTeamInfo(homeTeam)}</div>
      </div>

      <div className={styles.centerSection}>
        {date && (
          <div className={styles.dateRow}>
            <div className={styles.date}>{date}</div>
            {matchTypeInfo && (
              <>
                <span
                  className={`${styles.matchTypeIndicator} ${isWrongType ? styles.wrong : ''}`}
                  data-tooltip-id={`match-type-${htMatchId}`}
                >
                  {matchTypeInfo.initials} <Info size={12} />
                </span>
                <Tooltip id={`match-type-${htMatchId}`} content={matchTypeInfo.description} />
              </>
            )}
          </div>
        )}
        <div className={styles.vsRow}>
          {status === 'finished' || status === 'ongoing' ? (
            <>
              <span className={styles.score}>
                {score?.home ?? 0}
                {hasPenaltyShootout && penaltyShootout ? <sup>({penaltyShootout.home})</sup> : null}
              </span>
              <span className={styles.vs}>VS</span>
              <span className={styles.score}>
                {score?.away ?? 0}
                {hasPenaltyShootout && penaltyShootout ? <sup>({penaltyShootout.away})</sup> : null}
              </span>
            </>
          ) : (
            <>
              <span className={styles.scorePlaceholder}>-</span>
              <span className={styles.vs}>VS</span>
              <span className={styles.scorePlaceholder}>-</span>
            </>
          )}
        </div>
        {['arranged', 'ongoing', 'finished'].includes(status) && htMatchId ? (
          <a
            href={`https://www.hattrick.org/goto.ashx?path=/Club/Matches/Match.aspx?matchID=${htMatchId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.badgeLink}
          >
            {badgeContent}
          </a>
        ) : (
          badgeContent
        )}
      </div>

      <div className={`${styles.teamContainer} ${styles.right}`}>
        <div className={`${styles.teamDetails} ${styles.right}`}>{renderTeamInfo(awayTeam, true)}</div>
        <div className={styles.logoWrapper}>
          <img src={awayTeam.logoUrl || '/hero-logo-2.png'} alt={awayTeam.name} className={styles.logo} />
        </div>
      </div>
    </div>
  );
};
