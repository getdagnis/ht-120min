import React from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Info } from 'phosphor-react';
import { Tooltip } from '../Tooltip/Tooltip';
import { TeamByline } from '../TeamByline/TeamByline';
import { appgOutcomeLabel, type AppgOutcome } from '../../utils/appg';
import type { MatchSideEventDetails } from '../../../shared/match-events';
import { getLiveClockDisplay, type LiveMatchClock } from '../../../shared/live-match';
import styles from './FixtureCard.module.sass';

interface TeamProps {
  name: string;
  isBye?: boolean;
  managerName?: string;
  managerHtId?: number;
  htTeamId: number;
  logoUrl?: string;
  matchKitUrl?: string | null;
  warning?: 'yellow' | 'red';
  reserveReplacingName?: string;
  countryName?: string;
  countryId?: number;
  matchSummary?: {
    yellowCards: number;
    redCards: number;
    injuries: number;
    eventDetails?: MatchSideEventDetails | null;
  } | null;
}

interface FixtureCardProps {
  homeTeam: TeamProps;
  awayTeam: TeamProps;
  status: 'arranged' | 'not_arranged' | 'ongoing' | 'misarranged' | 'finished';
  liveClock?: Partial<LiveMatchClock>;
  liveKickoff?: Date | string;
  score?: { home: number; away: number };
  penaltyShootout?: { home: number; away: number } | null;
  date?: string;
  htMatchId?: number;
  matchType?: number;
  is120minMode?: boolean;
  scoring_mode?: string;
  went_120?: boolean;
  completed?: boolean;
  totalMinutes?: number;
  appgOutcome?: AppgOutcome | null;
  challengeAction?: {
    direction: 'left' | 'right';
    onClick: () => void;
  };
  ratingsPreview?: {
    home: RatingsPreviewTeam | null;
    away: RatingsPreviewTeam | null;
  };
  ratingsSharedStatus?: { home: boolean; away: boolean };
  ratingsActions?: {
    home: boolean;
    away: boolean;
    onAction: (side: 'home' | 'away', action: 'share' | 'update' | 'remove') => Promise<void>;
  };
}

interface RatingsPreviewTeam {
  fetchedAt: string;
  formation: string;
  tactic: string;
  tacticSkill: string;
  setPieces: string;
  ratings: {
    leftAttack: string;
    centreAttack: string;
    rightAttack: string;
    midfield: string;
    leftDefence: string;
    centreDefence: string;
    rightDefence: string;
  };
}

const MATCH_TYPES: Record<number, { initials: string; description: string }> = {
  4: { initials: 'NF', description: "Normal 90' Friendly" },
  5: { initials: 'CR', description: 'Cup Rules Friendly' },
  8: { initials: 'IF', description: "International 90' Friendly" },
  9: { initials: 'ICR', description: 'International Cup Rules Friendly' },
};

const DEFAULT_TEAM_LOGO = '/matchKitLarge.png';

export const FixtureCard: React.FC<FixtureCardProps> = ({
  homeTeam,
  awayTeam,
  status,
  liveClock,
  liveKickoff,
  score,
  penaltyShootout,
  date,
  htMatchId,
  matchType,
  is120minMode,
  went_120,
  completed,
  totalMinutes,
  appgOutcome,
  challengeAction,
  ratingsPreview,
  ratingsSharedStatus,
  ratingsActions,
}) => {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [busySide, setBusySide] = React.useState<'home' | 'away' | null>(null);
  const [refreshedSide, setRefreshedSide] = React.useState<'home' | 'away' | null>(null);
  const refreshedTimer = React.useRef<number | null>(null);
  const [ratingsError, setRatingsError] = React.useState<string | null>(null);
  const act = async (side: 'home' | 'away', action: 'share' | 'update' | 'remove') => {
    if (!ratingsActions || busySide) return;
    setBusySide(side);
    setRefreshedSide(null);
    if (refreshedTimer.current !== null) window.clearTimeout(refreshedTimer.current);
    setRatingsError(null);
    try {
      await ratingsActions.onAction(side, action);
      if (action === 'update') {
        setRefreshedSide(side);
        refreshedTimer.current = window.setTimeout(() => {
          setRefreshedSide(null);
          refreshedTimer.current = null;
        }, 3000);
      }
    } catch (error) {
      setRatingsError(error instanceof Error ? error.message : 'Could not update shared ratings.');
    } finally {
      setBusySide(null);
    }
  };
  React.useEffect(
    () => () => {
      if (refreshedTimer.current !== null) window.clearTimeout(refreshedTimer.current);
    },
    [],
  );
  React.useEffect(() => {
    if (status !== 'ongoing') return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);
  const appgOutcomeText =
    completed && appgOutcome && appgOutcome !== 'needs_review' ? appgOutcomeLabel(appgOutcome) : null;
  const hasPenaltyShootout = Boolean(
    penaltyShootout && penaltyShootout.home !== null && penaltyShootout.away !== null && went_120 && completed,
  );
  const isReserveReplacement = Boolean(homeTeam.reserveReplacingName || awayTeam.reserveReplacingName);
  const badgeContent = (
    <div
      className={`${styles.statusBadge} ${styles[status]} ${isReserveReplacement && status === 'arranged' ? styles.replaced : ''}`}
    >
      {completed && (
        <div className={`${styles.minutesBadge} ${went_120 ? styles.achievedMinutes : ''}`}>
          {hasPenaltyShootout ? '120+PS!' : `${totalMinutes ?? (went_120 ? 120 : 90)}'${went_120 ? '!' : ''}`}
        </div>
      )}
      <div className={styles.badgeRight}>
        {status === 'ongoing'
          ? getLiveClockDisplay({
              kickoffMs: liveKickoff ? new Date(liveKickoff).getTime() : null,
              nowMs,
              phase: liveClock?.phase,
              announcedAddedMinutes: liveClock?.announcedAddedMinutes,
            })
          : status === 'arranged' && isReserveReplacement
            ? 'REPLACED'
            : status.replace('_', ' ').toUpperCase()}{' '}
        {['arranged', 'ongoing', 'finished'].includes(status) && (
          <ArrowUpRight size={16} weight="bold" className={styles.statusBadgeIcon} />
        )}
      </div>
    </div>
  );

  const matchTypeInfo = matchType ? { ...MATCH_TYPES[matchType] } : null;
  if (matchTypeInfo && matchType === 5 && completed && went_120) {
    matchTypeInfo.initials = hasPenaltyShootout ? '120m+PS' : '120m';
    matchTypeInfo.description = hasPenaltyShootout
      ? '120m cup rules match decided by penalty shootout'
      : '120m cup rules match';
  }

  const isWrongType = is120minMode && matchType && [4, 7].includes(matchType);

  const renderTeamInfo = (team: TeamProps, isRight?: boolean) => (
    <>
      {team.reserveReplacingName && (
        <div className={styles.reserveRow}>
          <span>REPLACING {team.reserveReplacingName}!</span>
        </div>
      )}
      <div className={styles.teamName}>{team.name.toUpperCase()}</div>
      {!team.isBye && (
        <TeamByline
          countryName={team.countryName}
          countryId={team.countryId}
          teamId={team.htTeamId}
          teamName={team.name}
          managerName={team.managerName}
          managerHtId={team.managerHtId}
          mode="fixtures"
          isRight={isRight}
          matchSummary={team.matchSummary}
          matchKitUrl={team.warning ? null : team.matchKitUrl}
        />
      )}
      {team.warning && (
        <div className={styles.warningRow}>
          <img src="/warn-red.png" alt="Warning" className={styles.warnIcon} />
          <span className={styles.warn}>Misarranged fixture!</span>
        </div>
      )}
    </>
  );

  return (
    <div className={`${styles.fixtureCard} ${ratingsPreview || ratingsSharedStatus ? styles.withRatingsPreview : ''}`}>
      <div className={styles.teamContainer}>
        <div className={styles.logoWrapper}>
          {!homeTeam.isBye && (
            <img
              src={homeTeam.logoUrl || DEFAULT_TEAM_LOGO}
              alt={homeTeam.name}
              className={styles.logo}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = DEFAULT_TEAM_LOGO;
              }}
            />
          )}
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
                <Tooltip id={`match-type-${htMatchId}`} content={matchTypeInfo.description} className="tooltip" />
              </>
            )}
          </div>
        )}
        <div className={styles.vsRow}>
          {completed || status === 'ongoing' ? (
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
        {challengeAction ? (
          <button
            type="button"
            className={`${styles.statusBadge} ${styles.arranged} ${styles.challengeAction}`}
            onClick={challengeAction.onClick}
          >
            {challengeAction.direction === 'left' ? <ArrowLeft size={18} weight="bold" /> : null}
            Send Challenge!
            {challengeAction.direction === 'right' ? <ArrowRight size={18} weight="bold" /> : null}
          </button>
        ) : ['arranged', 'ongoing', 'finished'].includes(status) && htMatchId ? (
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
        {appgOutcomeText && <div className={styles.appgOutcome}>{appgOutcomeText}</div>}
      </div>

      <div className={`${styles.teamContainer} ${styles.right}`}>
        <div className={`${styles.teamDetails} ${styles.right}`}>{renderTeamInfo(awayTeam, true)}</div>
        <div className={styles.logoWrapper}>
          {!awayTeam.isBye && (
            <img
              src={awayTeam.logoUrl || DEFAULT_TEAM_LOGO}
              alt={awayTeam.name}
              className={styles.logo}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = DEFAULT_TEAM_LOGO;
              }}
            />
          )}
        </div>
      </div>
      {ratingsPreview && (
        <section className={styles.ratingsPreview} aria-label="Shared match ratings">
          {(ratingsPreview.home || ratingsPreview.away) && (
            <div className={styles.ratingsPreviewTitle}>Shared match ratings</div>
          )}
          {(['home', 'away'] as const).map((side) => {
            const team = side === 'home' ? homeTeam : awayTeam;
            const preview = ratingsPreview[side];
            const canManage = ratingsActions?.[side] || false;
            if (!preview && !canManage) return null;
            const sectorRows: Array<Array<[string, string]>> = preview
              ? [
                  [
                    ['Left attack:', preview.ratings.leftAttack],
                    ['Center attack:', preview.ratings.centreAttack],
                    ['Right attack:', preview.ratings.rightAttack],
                  ],
                  [['Midfield (excluding TS effect): ', preview.ratings.midfield]],
                  [
                    ['Left defence:', preview.ratings.leftDefence],
                    ['Center defence:', preview.ratings.centreDefence],
                    ['Right defence:', preview.ratings.rightDefence],
                  ],
                ]
              : [];
            return (
              <div key={side} className={`${styles.ratingsSide} ${side === 'away' ? styles.ratingsSideAway : ''}`}>
                {preview && (
                  <div className={styles.ratingsTeamHeading}>
                    {side === 'home' && <strong>{team.name}</strong>}
                    <span>{side === 'home' ? 'shared their ratings' : 'Shared with opponent by'}</span>
                    {side === 'away' && <strong>{team.name}</strong>}
                  </div>
                )}
                {preview ? (
                  <>
                    <div className={styles.ratingsPitch}>
                      {sectorRows.map((row, rowIndex) => (
                        <div
                          key={rowIndex}
                          className={`${styles.ratingsSectorRow} ${row.length === 1 ? styles.ratingsMidfieldRow : ''}`}
                        >
                          {row.map(([label, value]) => (
                            <div className={styles.ratingsSector} key={label}>
                              <span>{label}</span>
                              <strong>{value}</strong>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className={styles.ratingsMetadata}>
                      <span>
                        Formation <strong>{preview.formation}</strong>
                      </span>
                      <span>
                        Tactic <strong>{preview.tactic}</strong>
                      </span>
                      <span>
                        Tactic skill <strong>{preview.tacticSkill}</strong>
                      </span>
                      <span>
                        Set Pieces taker <strong>{preview.setPieces}</strong>
                      </span>
                    </div>
                    <div
                      className={`${styles.ratingsPreviewActions} ${styles.ratingsPreviewActionsEdgeAligned} ${
                        side === 'away' ? styles.ratingsPreviewActionsAway : ''
                      }`}
                    >
                      {canManage && (
                        <button type="button" disabled={busySide !== null} onClick={() => void act(side, 'update')}>
                          {busySide === side
                            ? 'Updating...'
                            : refreshedSide === side
                              ? 'Ratings refreshed'
                              : 'Refresh ratings'}
                        </button>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          className={styles.ratingsPreviewRemove}
                          disabled={busySide !== null}
                          onClick={() => void act(side, 'remove')}
                        >
                          Stop sharing
                        </button>
                      )}
                      <span>
                        Last updated:{' '}
                        {new Intl.DateTimeFormat('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Europe/Riga',
                        }).format(new Date(preview.fetchedAt))}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className={styles.ratingsShareState}>
                    <div
                      className={`${styles.ratingsPreviewActions} ${styles.ratingsPreviewActionsEdgeAligned} ${
                        side === 'away' ? styles.ratingsPreviewActionsAway : ''
                      }`}
                    >
                      <button type="button" disabled={busySide !== null} onClick={() => void act(side, 'share')}>
                        Share predicted ratings
                      </button>
                    </div>
                    <p className={styles.ratingsShareHelper}>
                      Share predicted ratings with your opponent. Your shared snapshot updates when you click Refresh
                      fixtures.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {ratingsError && (
            <p role="alert" className={styles.ratingsError}>
              {ratingsError}
            </p>
          )}
        </section>
      )}
      {ratingsSharedStatus && (
        <section className={styles.ratingsSharedStatus} aria-label="Shared rating prediction status">
          {ratingsSharedStatus.home && <p>{homeTeam.name} have shared their predicted ratings! ✅</p>}
          {ratingsSharedStatus.away && <p>{awayTeam.name} have shared their predicted ratings! ✅</p>}
        </section>
      )}
    </div>
  );
};
