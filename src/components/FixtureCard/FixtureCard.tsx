import type { FixtureRatingNotice } from '../../types/fixture-ratings';
import { useTranslations } from 'next-intl';
import React from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Info } from 'phosphor-react';
import { Tooltip } from '../Tooltip/Tooltip';
import { TeamByline } from '../TeamByline/TeamByline';
import { appgOutcomeLabel, type AppgOutcome } from '../../utils/appg';
import { skillDisplay } from '../../utils/hattrick-skill';
import {
  getFormationIndicatorScore,
  getMatchMindsetIndicator,
  getSetPieceIndicatorScore,
  getTacticIndicatorScore,
} from '../../utils/rating-indicators';
import type { RatingIndicatorScore } from '../../utils/rating-indicators';
import type { MatchSideEventDetails, MatchSidePerformance } from '../../../shared/match-events';
import type { SpecialtyPositionGroup } from '../../../shared/player-specialties';
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
  dateIsEstimated?: boolean;
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
  ratingsSharedStatus?: { home: FixtureRatingNotice | null; away: FixtureRatingNotice | null };
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
  tacticSkill: number | null;
  coachModifier: number | null;
  setPieces: string;
  setPiecesSkill: number | null;
  specialtyPositions: SpecialtyPositionGroup[];
  specialtyPositionsKnown?: boolean;
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

type RatedSector =
  | 'leftAttack'
  | 'centreAttack'
  | 'rightAttack'
  | 'midfield'
  | 'leftDefence'
  | 'centreDefence'
  | 'rightDefence';

const OPPOSING_SECTORS: Record<RatedSector, RatedSector> = {
  leftAttack: 'rightDefence',
  centreAttack: 'centreDefence',
  rightAttack: 'leftDefence',
  midfield: 'midfield',
  leftDefence: 'rightAttack',
  centreDefence: 'centreAttack',
  rightDefence: 'leftAttack',
};

// Tune these values against real matchups. Midfield values are percentages;
// attack/defence values are multipliers (1.5 means 50% higher).
const EXTRA_TIME_COMPARISON = {
  defenceGreenRatio: 1.25,
  attackRedRatio: 1.35,
  midfieldGreenBelowPercent: 20,
  midfieldYellowAbovePercent: 30,
  midfieldRedAtPercent: 55,
} as const;

function sectorComparisonClass(sector: RatedSector, value: string, opposingValue: string | undefined) {
  if (!value.trim() || !opposingValue?.trim()) return undefined;
  const own = Number(value),
    opponent = Number(opposingValue);
  if (!Number.isFinite(own) || !Number.isFinite(opponent) || own < 0 || opponent < 0) return undefined;
  const epsilon = 1e-9; // Keep exact boundaries stable after floating-point division.

  if (sector === 'midfield') {
    const lower = Math.min(own, opponent),
      higher = Math.max(own, opponent);
    const difference = lower === 0 ? (higher === 0 ? 0 : Infinity) : (higher / lower - 1) * 100;
    if (difference < EXTRA_TIME_COMPARISON.midfieldGreenBelowPercent - epsilon) return ratingIndicatorClass(1);
    if (difference >= EXTRA_TIME_COMPARISON.midfieldRedAtPercent - epsilon) return ratingIndicatorClass(4);
    if (difference > EXTRA_TIME_COMPARISON.midfieldYellowAbovePercent + epsilon) return ratingIndicatorClass(3);
    return undefined;
  }

  const attack = sector.endsWith('Attack') ? own : opponent;
  const defence = sector.endsWith('Defence') ? own : opponent;
  if (attack === 0 && defence === 0) return undefined;
  // Both matched numbers get the same color: a defensive advantage favors a draw.
  if (defence >= attack * EXTRA_TIME_COMPARISON.defenceGreenRatio - epsilon) return ratingIndicatorClass(1);
  if (attack >= defence * EXTRA_TIME_COMPARISON.attackRedRatio - epsilon) return ratingIndicatorClass(4);
  return undefined;
}

const RATED_SECTOR_ROLES: Record<RatedSector, number[]> = {
  leftAttack: [110],
  centreAttack: [111, 112, 113],
  rightAttack: [106],
  midfield: [107, 108, 109],
  leftDefence: [105],
  centreDefence: [102, 103, 104],
  rightDefence: [101],
};
const SPECIALTY_NAMES: Record<number, string> = {
  1: 'Technical',
  2: 'Quick',
  3: 'Powerful',
  4: 'Unpredict.',
  5: 'Head',
  6: 'Resilient',
  8: 'Support',
};

// CHPP slot pairs are mirrored for opposing lineups. Midfielders can be both
// event initiators and cover; coverage elsewhere is only a possible mitigation.
const QUICK_OPPOSING_ROLES: Record<number, number> = {
  101: 110,
  102: 113,
  103: 112,
  104: 111,
  105: 106,
  106: 105,
  107: 109,
  108: 108,
  109: 107,
  110: 101,
  111: 104,
  112: 103,
  113: 102,
};
const SPECIALTY_MATCHUP_COLORS = {
  technicalThreat: 'ratingIndicator4',
  headVulnerable: 'ratingIndicator4',
  quickUncovered: 'ratingIndicator4',
  quickPartial: 'ratingIndicator3',
  quickDirectCover: 'ratingIndicator1',
  quickPossibleCover: 'ratingIndicator1',
} as const;
type SpecialtyMatchup = keyof typeof SPECIALTY_MATCHUP_COLORS;
const eventInitiator = (role: number) => role >= 106 && role <= 113;
const defensiveEventRole = (role: number) => (role >= 101 && role <= 105) || (role >= 107 && role <= 109);

function specialtyMatchup(
  specialtyId: number,
  role: number,
  opposing: SpecialtyPositionGroup[] | undefined,
): SpecialtyMatchup | null {
  if (!opposing) return null; // Unavailable specialty data is not an empty lineup.
  const opposingRoles = (id: number) =>
    opposing.filter((group) => group.specialtyId === id).flatMap((group) => group.roleIds);
  if (specialtyId === 1 && eventInitiator(role) && opposingRoles(5).some(defensiveEventRole)) return 'technicalThreat';
  if (specialtyId === 5 && defensiveEventRole(role) && opposingRoles(1).some(eventInitiator)) return 'headVulnerable';
  if (specialtyId !== 2) return null; // Head players do not cancel opposing Head threats.
  const quick = opposingRoles(2);
  if (eventInitiator(role)) {
    const cover = quick.filter(defensiveEventRole);
    if (!cover.includes(QUICK_OPPOSING_ROLES[role])) {
      return cover.length ? 'quickPartial' : 'quickUncovered';
    }
  }
  if (defensiveEventRole(role)) {
    const threats = quick.filter(eventInitiator);
    if (threats.includes(QUICK_OPPOSING_ROLES[role])) return 'quickDirectCover';
    if (threats.length) return 'quickPossibleCover';
  }
  return null;
}

function specialtyMarkersForSector(
  groups: SpecialtyPositionGroup[],
  sector: RatedSector,
  opposing?: SpecialtyPositionGroup[],
) {
  const roles = new Set(RATED_SECTOR_ROLES[sector]);
  const markers = new Map<string, { specialtyId: number; count: number; matchup: SpecialtyMatchup | null }>();
  for (const group of groups) {
    if (!SPECIALTY_NAMES[group.specialtyId]) continue;
    for (const role of group.roleIds.filter((id) => roles.has(id))) {
      const matchup = specialtyMatchup(group.specialtyId, role, opposing);
      const key = `${group.specialtyId}:${matchup}`;
      const marker = markers.get(key);
      if (marker) marker.count++;
      else markers.set(key, { specialtyId: group.specialtyId, count: 1, matchup });
    }
  }
  return [...markers.values()];
}

function ratingIndicatorClass(score: RatingIndicatorScore | null | undefined) {
  if (score === null || score === undefined || score === 0) return undefined;
  return styles[`ratingIndicator${score}`];
}

function TacticValue({ tactic, skill }: { tactic: string | null | undefined; skill?: number | null }) {
  const showSkill =
    tactic && tactic.trim().toLowerCase() !== 'normal' && typeof skill === 'number' && Number.isFinite(skill);
  return (
    <span className={ratingIndicatorClass(getTacticIndicatorScore(tactic))}>
      {tactic || '—'}
      {showSkill ? ` (${skill})` : ''}
    </span>
  );
}

function GameStyle({ styleOfPlay }: { styleOfPlay: number | null | undefined }) {
  const uiText = useTranslations('PublicUI.GameStyle');
  const mindset = getMatchMindsetIndicator(styleOfPlay);
  if (!mindset) return null;

  return (
    <span>
      {uiText('style')} <strong className={ratingIndicatorClass(mindset.score)}>{mindset.label}</strong>
    </span>
  );
}

function RatingsPitch({
  ratings,
  opposingRatings,
  specialtyPositions = [],
  opposingSpecialtyPositions,
  midfieldLabel = 'Midfield, predicted:',
}: {
  ratings: RatingsPreviewTeam['ratings'];
  opposingRatings?: RatingsPreviewTeam['ratings'];
  specialtyPositions?: SpecialtyPositionGroup[];
  opposingSpecialtyPositions?: SpecialtyPositionGroup[];
  midfieldLabel?: string;
}) {
  const uiText = useTranslations('PublicUI.RatingsPitch');
  const tooltipId = React.useId();
  const sectorRows: Array<Array<[string, string, RatedSector?]>> = [
    [
      ['Left attack (LW):', ratings.leftAttack, 'leftAttack'],
      ['Center attack:', ratings.centreAttack, 'centreAttack'],
      ['Right attack (RW):', ratings.rightAttack, 'rightAttack'],
    ],
    [[midfieldLabel, ratings.midfield, 'midfield']],
    [
      ['Left defence:', ratings.leftDefence, 'leftDefence'],
      ['Center defence:', ratings.centreDefence, 'centreDefence'],
      ['Right defence:', ratings.rightDefence, 'rightDefence'],
    ],
  ];

  return (
    <div className={styles.ratingsPitch}>
      {sectorRows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className={`${styles.ratingsSectorRow} ${row.length === 1 ? styles.ratingsMidfieldRow : ''}`}
        >
          {row.map(([label, value, sector]) => {
            const markers = sector
              ? specialtyMarkersForSector(specialtyPositions, sector, opposingSpecialtyPositions)
              : [];
            const comparisonClass =
              sector && opposingRatings
                ? sectorComparisonClass(sector, value, opposingRatings[OPPOSING_SECTORS[sector]])
                : undefined;
            let comparisonTitle: string | undefined;
            if (sector && comparisonClass) {
              const favorable = comparisonClass === styles.ratingIndicator1;
              if (sector === 'midfield') {
                comparisonTitle = uiText(
                  favorable ? 'midfieldBalanced'
                    : comparisonClass === styles.ratingIndicator4 ? 'midfieldVeryDifferent' : 'midfieldDifferent',
                );
              } else {
                const message = sector.endsWith('Defence')
                  ? favorable ? 'defenceStronger' : 'defenceWeaker'
                  : favorable ? 'attackContained' : 'attackStronger';
                comparisonTitle = uiText(message, {
                  own: uiText(sector),
                  opponent: uiText(OPPOSING_SECTORS[sector]).toLocaleLowerCase(),
                });
              }
            }
            return (
              <div className={styles.ratingsSector} key={label}>
                <span>{label}</span>
                <div className={styles.ratingsValue}>
                  <strong
                    className={comparisonClass}
                    data-tooltip-id={comparisonTitle ? tooltipId : undefined}
                    data-tooltip-content={comparisonTitle}
                    tabIndex={comparisonTitle ? 0 : undefined}
                    onPointerDown={comparisonTitle ? (event) => event.currentTarget.focus() : undefined}
                  >
                    {value}
                  </strong>
                  {markers.length > 0 && (
                    <small
                      className={styles.ratingsSpecialtyIcons}
                      aria-label={uiText('specialtiesContributingToThisRating')}
                    >
                      {markers.map(({ specialtyId, count, matchup }) => (
                        <span
                          key={`${specialtyId}:${matchup}`}
                          className={matchup ? styles[SPECIALTY_MATCHUP_COLORS[matchup]] : undefined}
                          data-tooltip-id={tooltipId}
                          data-tooltip-content={`${count > 1 ? `${count} ` : ''}${SPECIALTY_NAMES[specialtyId]}${matchup ? ` — ${uiText(matchup)}` : ''}`}
                          tabIndex={0}
                          onPointerDown={(event) => event.currentTarget.focus()}
                        >
                          {count > 1 && `${count}×`}
                          <i
                            className={styles.ratingsSpecialtyIcon}
                            data-specialty-id={specialtyId}
                            aria-label={`${SPECIALTY_NAMES[specialtyId]}${matchup ? ` — ${uiText(matchup)}` : ''}`}
                            role="img"
                          />
                        </span>
                      ))}
                    </small>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <Tooltip id={tooltipId} content="" />
    </div>
  );
}

function actualRatingsDisplay(performance?: MatchSidePerformance): RatingsPreviewTeam['ratings'] {
  const format = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : ((value + 3) / 4).toFixed(2);
  return {
    leftAttack: format(performance?.ratings.leftAttack),
    centreAttack: format(performance?.ratings.centralAttack),
    rightAttack: format(performance?.ratings.rightAttack),
    midfield: format(performance?.ratings.midfield),
    leftDefence: format(performance?.ratings.leftDefence),
    centreDefence: format(performance?.ratings.centralDefence),
    rightDefence: format(performance?.ratings.rightDefence),
  };
}

const DEFAULT_TEAM_LOGO = '/matchKitLarge.png';

const ROLE_NAMES: Record<number, string> = {
  100: 'GK',
  101: 'RD',
  102: 'CD',
  103: 'CD',
  104: 'CD',
  105: 'LD',
  106: 'RW',
  107: 'IM',
  108: 'IM',
  109: 'IM',
  110: 'LW',
  111: 'FW',
  112: 'FW',
  113: 'FW',
};

function specialtyPositionText(group: SpecialtyPositionGroup) {
  const roleCounts = new Map<string, number>();
  for (const roleId of group.roleIds) {
    const role = ROLE_NAMES[roleId];
    if (role) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const positions = [...roleCounts].map(([role, count]) => (count > 1 ? `${count}x ${role}` : role));
  return `${SPECIALTY_NAMES[group.specialtyId] ?? 'Specialty'}: ${positions.join(', ')}`;
}

export const FixtureCard: React.FC<FixtureCardProps> = ({
  homeTeam,
  awayTeam,
  status,
  liveClock,
  liveKickoff,
  score,
  penaltyShootout,
  date,
  dateIsEstimated = false,
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
  const uiText = useTranslations('PublicUI.FixtureCard');
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [busySide, setBusySide] = React.useState<'home' | 'away' | null>(null);
  const [refreshedSide, setRefreshedSide] = React.useState<'home' | 'away' | null>(null);
  const refreshedTimer = React.useRef<number | null>(null);
  const [ratingsError, setRatingsError] = React.useState<string | null>(null);
  const [actualDetailsExpanded, setActualDetailsExpanded] = React.useState(false);
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
          {hasPenaltyShootout ? uiText('120PS') : `${totalMinutes ?? (went_120 ? 120 : 90)}'${went_120 ? '!' : ''}`}
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
          <span>
            {uiText('rEPLACING')} {team.reserveReplacingName}!
          </span>
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
          <img src="/warn-red.png" alt={uiText('warning')} className={styles.warnIcon} />
          <span className={styles.warn}>{uiText('misarrangedFixture')}</span>
        </div>
      )}
    </>
  );

  return (
    <div
      className={`${styles.fixtureCard} ${ratingsPreview || ratingsSharedStatus ? styles.withRatingsPreview : ''} ${status === 'finished' ? styles.withFinishedDetails : ''}`}
    >
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
            {dateIsEstimated && (
              <span className={styles.estimatedDate} title={uiText('estimatedFromThePlannedSchedule')}>
                {uiText('estimated')}
              </span>
            )}
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
              <span className={styles.vs}>{uiText('vS')}</span>
              <span className={styles.score}>
                {score?.away ?? 0}
                {hasPenaltyShootout && penaltyShootout ? <sup>({penaltyShootout.away})</sup> : null}
              </span>
            </>
          ) : (
            <>
              <span className={styles.scorePlaceholder}>-</span>
              <span className={styles.vs}>{uiText('vS')}</span>
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
            {uiText('sendChallenge')}
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
        {status === 'finished' && (
          <button
            type="button"
            className={styles.detailsToggle}
            aria-expanded={actualDetailsExpanded}
            onClick={() => setActualDetailsExpanded((expanded) => !expanded)}
          >
            {actualDetailsExpanded ? uiText('hideDetails') : uiText('showDetails')}
          </button>
        )}
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
      {(ratingsPreview || ratingsSharedStatus) && (
        <section className={styles.ratingsPreview} aria-label={uiText('sharedMatchRatings')}>
          {(ratingsPreview?.home || ratingsPreview?.away) && (
            <div className={styles.ratingsPreviewTitle}>{uiText('sharedMatchRatings')}</div>
          )}
          {(['home', 'away'] as const).map((side) => {
            const team = side === 'home' ? homeTeam : awayTeam;
            const preview = ratingsPreview?.[side];
            const opponent = side === 'home' ? awayTeam : homeTeam;
            const opposingPreview = ratingsPreview?.[side === 'home' ? 'away' : 'home'];
            const notice = ratingsSharedStatus?.[side];
            const canManage = ratingsActions?.[side] || false;
            if (!preview && !canManage && !notice) return null;
            return (
              <div key={side} className={`${styles.ratingsSide} ${side === 'away' ? styles.ratingsSideAway : ''}`}>
                {!preview && notice && (
                  <p className={styles.ratingsNotice}>
                    {team.name}{' '}
                    {uiText(
                      notice === 'shared'
                        ? 'haveSharedTheirPredictedRatings'
                        : notice === 'orders-unset'
                          ? 'hasNotSetMatchOrders'
                          : notice === 'not-shared'
                            ? 'hasNotSharedPredictedRatings'
                            : 'matchOrderRatingsStatusUnclear',
                    )}
                  </p>
                )}
                {preview && (
                  <div className={styles.ratingsTeamHeading}>
                    {side === 'home' && <strong>{team.name}</strong>}
                    <span>{side === 'home' ? uiText('sharedTheirRatings') : uiText('sharedWithOpponentBy')}</span>
                    {side === 'away' && <strong>{team.name}</strong>}
                  </div>
                )}
                {preview ? (
                  <>
                    <RatingsPitch
                      ratings={preview.ratings}
                      opposingRatings={
                        ratingsPreview?.home && ratingsPreview.away
                          ? ratingsPreview[side === 'home' ? 'away' : 'home']?.ratings
                          : undefined
                      }
                      specialtyPositions={preview.specialtyPositions}
                      opposingSpecialtyPositions={
                        preview.specialtyPositionsKnown && opposingPreview?.specialtyPositionsKnown
                          ? opposingPreview.specialtyPositions
                          : undefined
                      }
                    />
                    <div className={styles.ratingsMetadata}>
                      <span>
                        {uiText('formation')}{' '}
                        <strong className={ratingIndicatorClass(getFormationIndicatorScore(preview.formation))}>
                          {preview.formation}
                        </strong>
                      </span>
                      <span>
                        {uiText('tactic')}{' '}
                        <strong>
                          <TacticValue tactic={preview.tactic} skill={preview.tacticSkill} />
                        </strong>
                      </span>
                      <GameStyle styleOfPlay={preview.coachModifier} />
                      <span>
                        {uiText('setPiecesTaker')}{' '}
                        <strong className={ratingIndicatorClass(getSetPieceIndicatorScore(preview.setPiecesSkill))}>
                          {preview.setPieces}
                        </strong>
                      </span>
                    </div>
                    {preview.specialtyPositions.length > 0 && (
                      <div className={styles.specialtySummary} aria-label={uiText('playerSpecialtiesByPosition')}>
                        <span className={styles.specialtySummaryLabel}>{uiText('specialties')}</span>
                        {preview.specialtyPositions.map((group) => (
                          <span key={group.specialtyId}>
                            <strong>{specialtyPositionText(group)}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      className={`${styles.ratingsPreviewActions} ${styles.ratingsPreviewActionsEdgeAligned} ${
                        side === 'away' ? styles.ratingsPreviewActionsAway : ''
                      }`}
                    >
                      {canManage && (
                        <button type="button" disabled={busySide !== null} onClick={() => void act(side, 'update')}>
                          {busySide === side
                            ? uiText('updating')
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
                          {uiText('stopSharing')}
                        </button>
                      )}
                      <span>
                        {uiText('lastUpdated')}{' '}
                        {new Intl.DateTimeFormat('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Europe/Riga',
                        }).format(new Date(preview.fetchedAt))}
                      </span>
                    </div>
                    {canManage && opponent.managerHtId && (
                      <div className={`${styles.ratingsPreviewActions} ${side === 'away' ? '' : styles.ratingsPreviewActionsEdgeAligned}`}>
                        <a
                          href={`https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=${opponent.managerHtId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {uiText('messageOpponent')}
                        </a>
                      </div>
                    )}
                  </>
                ) : canManage ? (
                  <div className={styles.ratingsShareState}>
                    <div
                      className={`${styles.ratingsPreviewActions} ${styles.ratingsPreviewActionsEdgeAligned} ${
                        side === 'away' ? styles.ratingsPreviewActionsAway : ''
                      }`}
                    >
                      <button type="button" disabled={busySide !== null} onClick={() => void act(side, 'share')}>
                        {uiText('sharePredictedRatings')}
                      </button>
                    </div>
                    <p className={styles.ratingsShareHelper}>
                      {uiText('shareYourLineupPredictedRatingsWithYourOpponentYour')}
                    </p>
                  </div>
                ) : null}
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
      {status === 'finished' && actualDetailsExpanded && (
        <section className={styles.ratingsPreview} aria-label={uiText('actualMatchDetails')}>
          <div className={styles.ratingsPreviewTitle}>{uiText('actualMatchPerformance')}</div>
          {(['home', 'away'] as const).map((side) => {
            const team = side === 'home' ? homeTeam : awayTeam;
            const performance = team.matchSummary?.eventDetails?.performance;
            const taker = performance?.setPiecesTaker;
            return (
              <div key={side} className={`${styles.ratingsSide} ${side === 'away' ? styles.ratingsSideAway : ''}`}>
                <div className={styles.ratingsTeamHeading}>
                  {side === 'home' && <strong>{team.name}</strong>}
                  <span>{uiText('matchPerformance')}</span>
                  {side === 'away' && <strong>{team.name}</strong>}
                </div>
                <RatingsPitch
                  ratings={actualRatingsDisplay(performance)}
                  specialtyPositions={performance?.specialtyPositions ?? []}
                  midfieldLabel="Midfield:"
                />
                <div className={styles.ratingsMetadata}>
                  <span>
                    {uiText('formation')}{' '}
                    <strong className={ratingIndicatorClass(getFormationIndicatorScore(performance?.formation))}>
                      {performance?.formation || '—'}
                    </strong>
                  </span>
                  <span>
                    {uiText('tactic')}{' '}
                    <strong>
                      <TacticValue tactic={performance?.tacticName} skill={performance?.tacticSkill} />
                    </strong>
                  </span>
                  <GameStyle styleOfPlay={performance?.styleOfPlay} />
                  <span>
                    {uiText('setPiecesTaker')}{' '}
                    <strong className={ratingIndicatorClass(getSetPieceIndicatorScore(taker?.skill))}>
                      {skillDisplay(taker?.skill)}
                    </strong>
                  </span>
                </div>
                {!!performance?.specialtyPositions?.length && (
                  <div className={styles.specialtySummary} aria-label={uiText('playerSpecialtiesByPosition')}>
                    <span className={styles.specialtySummaryLabel}>{uiText('specialties')}</span>
                    {performance.specialtyPositions.map((group) => (
                      <span key={group.specialtyId}>
                        <strong>{specialtyPositionText(group)}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
};
