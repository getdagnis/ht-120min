import React from 'react';
import { ArrowRight, ArrowUpRight } from 'phosphor-react';
import styles from './FixtureCard.module.sass';

interface TeamProps {
  name: string;
  managerName?: string;
  htTeamId: number;
  logoUrl?: string;
  warning?: 'yellow' | 'red';
}

interface FixtureCardProps {
  homeTeam: TeamProps;
  awayTeam: TeamProps;
  status: 'arranged' | 'not_arranged' | 'ongoing' | 'misarranged' | 'finished';
  score?: { home: number; away: number };
  date?: string;
  htMatchId?: number;
}

export const FixtureCard: React.FC<FixtureCardProps> = ({ homeTeam, awayTeam, status, score, date, htMatchId }) => {
  const badgeContent = (
    <div className={`${styles.statusBadge} ${styles[status]}`}>
      {status.replace('_', ' ').toUpperCase()}{' '}
      {['arranged', 'ongoing', 'finished'].includes(status) && (
        <ArrowUpRight size={16} weight="bold" className={styles.statusBadgeIcon} />
      )}
    </div>
  );

  return (
    <div className={styles.fixtureCard}>
      {/* Home Team - Left Side */}
      <div className={styles.teamContainer}>
        <div className={styles.logoWrapper}>
          <img src={homeTeam.logoUrl || '/hero-logo-2.png'} alt={homeTeam.name} className={styles.logo} />
        </div>
        <div className={styles.teamDetails}>
          <div className={styles.teamName}>{homeTeam.name.toUpperCase()}</div>
          <div className={styles.teamMeta}>
            <a
              href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${homeTeam.htTeamId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkIcon}
            >
              <span>
                By {homeTeam.managerName || 'UNKNOWN'} / ID: {homeTeam.htTeamId}
              </span>
              <ArrowRight size={12} weight="bold" style={{ marginLeft: '0.25rem' }} />
            </a>
          </div>
          {homeTeam.warning && (
            <div className={styles.warningRow}>
              <img src="/warn-red.png" alt="Warning" className={styles.warnIcon} />
              <span className={styles.warn}>Warning issued!</span>
            </div>
          )}
        </div>
      </div>

      {/* Center Section */}
      <div className={styles.centerSection}>
        {date && <div className={styles.date}>{date}</div>}
        <div className={styles.vsRow}>
          {status === 'finished' ? (
            <>
              <span className={styles.score}>{score?.home ?? 0}</span>
              <span className={styles.vs}>VS</span>
              <span className={styles.score}>{score?.away ?? 0}</span>
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

      {/* Away Team - Right Side */}
      <div className={`${styles.teamContainer} ${styles.right}`}>
        <div className={`${styles.teamDetails} ${styles.right}`}>
          <div className={styles.teamName}>{awayTeam.name.toUpperCase()}</div>
          <div className={styles.teamMeta}>
            <a
              href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${awayTeam.htTeamId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkIcon}
            >
              <span>
                By {awayTeam.managerName || 'UNKNOWN'} / ID: {awayTeam.htTeamId}
              </span>
              <ArrowRight size={12} weight="bold" style={{ marginLeft: '0.25rem' }} />
            </a>
          </div>
          {awayTeam.warning && (
            <div className={styles.warningRow}>
              <img src="/warn-red.png" alt="Team issued a warning!" className={styles.warnIcon} />{' '}
              <span className={styles.warn}>Warning issued!</span>
            </div>
          )}
        </div>
        <div className={styles.logoWrapper}>
          <img src={awayTeam.logoUrl || '/hero-logo-2.png'} alt={awayTeam.name} className={styles.logo} />
        </div>
      </div>
    </div>
  );
};
