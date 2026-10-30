import type { FixtureRatingNotice } from '../../types/fixture-ratings';
import { useTranslations } from 'next-intl';
import React from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Info } from 'phosphor-react';
import { Tooltip } from '../Tooltip/Tooltip';
import { TeamByline, type FixtureRatingGrade } from '../TeamByline/TeamByline';
import { appgOutcomeLabel, type AppgOutcome } from '../../utils/appg';
import { skillDisplay } from '../../utils/hattrick-skill';
import { getMatchMindsetIndicator } from '../../utils/rating-indicators';
import type { RatingIndicatorScore } from '../../utils/rating-indicators';
import type { MatchSideEventDetails, MatchSidePerformance } from '../../../shared/match-events';
import {
  analyzeMatch120mCoaching,
  calculateMatch120mSpecialtyThreatBreakdown,
  countMatch120mSpecialtyPlayers,
  MATCH_120M_MAX_SE_THREAT_PENALTY,
  normalizeMatch120mGrade,
  isCounterAttacks,
  hasAdditionalTacticPenalty,
  type Match120mCoachingAnalysis,
  type Match120mRatedSector,
  type Match120mSpecialtyThreatBreakdown,
  type Match120mWarningGrade,
} from '../../../shared/match-120m-rating';
import type { SpecialtyPositionGroup } from '../../../shared/player-specialties';
import { getLiveClockDisplay, type LiveMatchClock } from '../../../shared/live-match';
import styles from './FixtureCard.module.sass';

type SpecialtyThreatGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

interface TeamProps {
  name: string;
  isBye?: boolean;
  managerName?: string;
  managerHtId?: number;
  htTeamId: number;
  logoUrl?: string;
  matchKitUrl?: string | null;
  ratingGrade?: FixtureRatingGrade;
  ratingScore?: number;
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
  matchId?: string;
  isOwned?: boolean;
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

function predicted120mPerformance(preview: RatingsPreviewTeam): MatchSidePerformance {
  const toRawRating = (value: string) => Number(value) * 4 - 3;
  return {
    formation: preview.formation,
    tacticType: null,
    tacticName: preview.tactic,
    tacticSkill: preview.tacticSkill,
    styleOfPlay: preview.coachModifier,
    setPiecesTaker: {
      playerName: null,
      skill: preview.setPiecesSkill,
      skillCheckedAt: null,
    },
    specialtyPositions: preview.specialtyPositionsKnown ? preview.specialtyPositions : undefined,
    possessionFirstHalf: null,
    possessionSecondHalf: null,
    ratings: {
      midfield: toRawRating(preview.ratings.midfield),
      rightDefence: toRawRating(preview.ratings.rightDefence),
      centralDefence: toRawRating(preview.ratings.centreDefence),
      leftDefence: toRawRating(preview.ratings.leftDefence),
      rightAttack: toRawRating(preview.ratings.rightAttack),
      centralAttack: toRawRating(preview.ratings.centreAttack),
      leftAttack: toRawRating(preview.ratings.leftAttack),
    },
    chances: { left: null, centre: null, right: null, specialEvents: null, other: null },
  } satisfies MatchSidePerformance;
}

const MATCH_TYPES: Record<number, { initials: string; description: string }> = {
  4: { initials: 'RR', description: "Regular 90' Rules Friendly" },
  5: { initials: 'CR', description: 'Cup Rules Friendly' },
  8: { initials: 'IF', description: "International 90' Friendly" },
  9: { initials: 'ICR', description: 'International Cup Rules Friendly' },
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

function specialtyMarkersForSector(
  groups: SpecialtyPositionGroup[],
  sector: Match120mRatedSector,
  analysis: Match120mCoachingAnalysis,
  threatGrade: SpecialtyThreatGrade,
) {
  const roleRanges: Record<Match120mRatedSector, number[]> = {
    leftAttack: [110],
    centreAttack: [111, 112, 113],
    rightAttack: [106],
    midfield: [107, 108, 109],
    leftDefence: [105],
    centreDefence: [102, 103, 104],
    rightDefence: [101],
  };
  const roles = new Set(roleRanges[sector]);
  const markers = new Map<number, { specialtyId: number; count: number; roles: number[] }>();
  for (const group of groups) {
    if (!SPECIALTY_NAMES[group.specialtyId]) continue;
    const specialtyRoles = group.roleIds.filter((id) => roles.has(id));
    if (!specialtyRoles.length) continue;
    const marker = markers.get(group.specialtyId);
    if (marker) {
      marker.count += specialtyRoles.length;
      marker.roles.push(...specialtyRoles);
    } else
      markers.set(group.specialtyId, {
        specialtyId: group.specialtyId,
        count: specialtyRoles.length,
        roles: specialtyRoles,
      });
  }
  return [...markers.values()]
    .map((marker) => {
      const specialtyCount = countMatch120mSpecialtyPlayers(groups, marker.specialtyId) ?? 0;
      const penalized = marker.roles.some((role) =>
        marker.specialtyId === 2
          ? role >= 106 && role <= 113
          : marker.specialtyId === 5 || marker.specialtyId === 4
            ? role >= 101 && role <= 113
            : marker.specialtyId === 1
              ? role === 106 || (role >= 110 && role <= 113)
              : marker.specialtyId === 3
                ? role >= 111 && role <= 113
                : false,
      );
      const threatPenaltyGrade = penalized && threatGrade !== 'A' && threatGrade !== 'B' ? threatGrade : null;
      return {
        ...marker,
        penalized,
        threatPenaltyGrade,
        red: penalized && specialtyCount >= 3,
        green:
          (marker.specialtyId === 2 && marker.roles.some((role) => analysis.quickDefensiveRoles.includes(role))) ||
          (marker.specialtyId === 3 && marker.roles.some((role) => analysis.powerfulPressingRoles.includes(role))),
      };
    })
    .sort(
      (a, b) =>
        Number(Boolean(b.threatPenaltyGrade) || b.red) - Number(Boolean(a.threatPenaltyGrade) || a.red) ||
        Number(b.green) - Number(a.green),
    );
}

function ratingIndicatorClass(score: RatingIndicatorScore | null | undefined) {
  if (score === null || score === undefined || score === 0) return undefined;
  return styles[`ratingIndicator${score}`];
}

function ratingWarningClass(grade: Match120mWarningGrade | undefined) {
  return grade ? styles[`ratingWarning${grade}`] : undefined;
}

function IndicatorTip({
  score,
  warningGrade,
  tone,
  content,
  children,
}: {
  score?: RatingIndicatorScore | null;
  warningGrade?: Match120mWarningGrade;
  tone?: string;
  content?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const indicatorClass = ratingWarningClass(warningGrade) ?? ratingIndicatorClass(score);
  if ((!indicatorClass && !tone) || !content) return <strong className={indicatorClass}>{children}</strong>;
  return (
    <>
      <strong
        className={indicatorClass}
        data-tooltip-id={id}
        data-tooltip-content={content}
        data-tooltip-tone={tone ?? (warningGrade ? `grade-${warningGrade.toLowerCase()}` : score)}
        tabIndex={0}
      >
        {children}
      </strong>
      <Tooltip id={id} content="" />
    </>
  );
}

function TacticValue({
  tactic,
  skill,
  score,
  tip,
}: {
  tactic: string | null | undefined;
  skill?: number | null;
  score: RatingIndicatorScore | null;
  tip: string;
}) {
  const showSkill =
    tactic && tactic.trim().toLowerCase() !== 'normal' && typeof skill === 'number' && Number.isFinite(skill);
  const displayScore =
    score === 1 &&
    tactic?.trim().toLowerCase() === 'pressing' &&
    typeof skill === 'number' &&
    Number.isFinite(skill) &&
    skill < 8
      ? 2
      : score;
  return (
    <IndicatorTip score={displayScore} content={tip}>
      {tactic || '—'}
      {showSkill ? ` (${skill})` : ''}
    </IndicatorTip>
  );
}

function GameStyle({
  styleOfPlay,
  analysis,
  text,
}: {
  styleOfPlay: number | null | undefined;
  analysis: Match120mCoachingAnalysis;
  text: (key: string) => string;
}) {
  const uiText = useTranslations('PublicUI.GameStyle');
  const mindset = getMatchMindsetIndicator(styleOfPlay);
  if (!mindset) return null;

  return (
    <span>
      {uiText('style')}{' '}
      <IndicatorTip score={analysis.mindsetScore} content={analysis.mindsetScore ? text('defensiveStyle') : ''}>
        {mindset.label}
      </IndicatorTip>
    </span>
  );
}

function gradeAdvice(
  analysis: Match120mCoachingAnalysis,
  grade: string,
  text: (key: string, values?: { grade?: string; formation?: string }) => string,
  score = analysis.rating?.score,
) {
  const description =
    grade === 'A+'
      ? text('ratingAPlus')
      : grade === 'A'
        ? text('ratingAlreadyA')
        : grade === 'A-'
          ? text('ratingAMinus')
          : grade === 'B+'
            ? text('ratingBPlus')
            : grade === 'B'
              ? text('ratingB')
              : grade === 'F-'
                ? text('ratingFMinus')
                : text('ratingAdvice');
  const gradeScore = score === undefined ? grade : `${grade} (${score}%)`;
  const heading = `${gradeScore}: ${description}`;
  const specialtyThresholdAdvice = new Set(['reduceQuick', 'reduceHead', 'reduceUnpredictable']);
  const rankedAdviceKeys = analysis.recommendations
    .filter((key) => !specialtyThresholdAdvice.has(key))
    .map((key) => ({ key, impact: analysis.recommendationImpacts[key] ?? 0 }))
    .filter(({ impact }) => impact > 0)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 2)
    .map(({ key }) => key);
  const adviceKeys =
    rankedAdviceKeys.length > 0
      ? rankedAdviceKeys
      : analysis.recommendations.includes('fineTuneLineup')
        ? ['fineTuneLineup']
        : grade === 'A'
          ? ['fineTuneForAPlus']
          : [];
  const advice = adviceKeys
    .map((key) =>
      key === 'chooseDefensiveFormation' && analysis.formation === '4-5-1'
        ? text('formation451')
        : text(key, key === 'chooseDefensiveFormation' ? { formation: analysis.formation ?? '—' } : undefined),
    )
    .map((tip) => `• ${tip}`)
    .join('\n');
  const sections = [heading];
  if (grade !== 'A+' && advice) {
    sections.push(`${text(grade === 'A' ? 'ratingImproveAPlus' : 'ratingImprove')}:\n${advice}`);
  }
  return sections.join(' ');
}

function formationAdvice(formation: string, text: (key: string) => string) {
  if (formation === '5-5-0') return text('formation550');
  if (formation === '5-4-1') return text('formation541');
  if (formation === '4-5-1') return text('formation451');
  if (formation === '5-2-3') return text('formation523');
  if (formation === '2-5-3') return text('formation253');
  if (formation === '3-5-2') return text('formation352');
  return text('aimDefensiveFormation');
}

function RatingsPitch({
  ratings,
  analysis,
  specialtyPositions = [],
  threatGrade,
  midfieldLabel = 'Midfield, predicted:',
}: {
  ratings: RatingsPreviewTeam['ratings'];
  analysis: Match120mCoachingAnalysis;
  specialtyPositions?: SpecialtyPositionGroup[];
  threatGrade: SpecialtyThreatGrade;
  midfieldLabel?: string;
}) {
  const uiText = useTranslations('PublicUI.RatingsPitch');
  const fixtureText = useTranslations('PublicUI.FixtureCard');
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
            const markers = sector ? specialtyMarkersForSector(specialtyPositions, sector, analysis, threatGrade) : [];
            const score = sector ? analysis.sectorScores[sector] : null;
            const warningGrade = sector ? analysis.sectorWarningGrades[sector] : undefined;
            const sectorValue = Number(value);
            let sectorTip = '';
            if (sector === 'midfield' && warningGrade === 'F') {
              sectorTip = uiText('midfieldBalanceCritical');
            } else if (sector === 'midfield' && warningGrade === 'E') {
              sectorTip = uiText('midfieldBalanceWarning');
            } else if (sector === 'midfield' && warningGrade === 'D') {
              sectorTip = uiText('midfieldBalanceDWarning');
            } else if (sector?.endsWith('Defence') && score === 1) {
              sectorTip = uiText('veryStrongDefence');
            } else if (sector?.endsWith('Defence') && score === 2) {
              sectorTip = uiText('strongDefence');
            } else if (sector && score === 4) {
              if (sector.endsWith('Defence')) sectorTip = uiText('weakDefence');
              else if (sectorValue >= 11.25) sectorTip = uiText('veryHighAttack');
              else if (sectorValue >= 8) sectorTip = uiText('dangerousAttack');
              else sectorTip = uiText('attackExceedsDefence');
            }
            return (
              <div className={styles.ratingsSector} key={label}>
                <span>{label}</span>
                <div className={styles.ratingsValue}>
                  <IndicatorTip score={score} warningGrade={warningGrade} content={sectorTip}>
                    {value}
                  </IndicatorTip>
                  {markers.length > 0 && (
                    <small
                      className={styles.ratingsSpecialtyIcons}
                      aria-label={uiText('specialtiesContributingToThisRating')}
                    >
                      {markers.map(({ specialtyId, count, penalized, threatPenaltyGrade, red, green }) => (
                        <span
                          key={specialtyId}
                          className={
                            threatPenaltyGrade
                              ? `${styles.ratingsThreatMarker} ${styles[`ratingGrade${threatPenaltyGrade}`]}`
                              : undefined
                          }
                        >
                          {count > 1 && (
                            <span
                              className={
                                threatPenaltyGrade
                                  ? undefined
                                  : red
                                    ? styles.ratingIndicator4
                                    : green
                                      ? styles.ratingIndicator1
                                      : undefined
                              }
                            >
                              {count}×
                            </span>
                          )}
                          <IndicatorTip
                            score={threatPenaltyGrade ? null : red ? 4 : green ? 1 : null}
                            tone={threatPenaltyGrade ? `grade-${threatPenaltyGrade.toLowerCase()}` : undefined}
                            content={
                              penalized
                                ? fixtureText('specialtyThreatPenaltyMarker')
                                : green
                                  ? specialtyId === 3
                                    ? fixtureText('powerfulPressingBenefit')
                                    : uiText('quickDefensiveCover')
                                  : ''
                            }
                          >
                            <i
                              className={styles.ratingsSpecialtyIcon}
                              data-specialty-id={specialtyId}
                              aria-label={SPECIALTY_NAMES[specialtyId]}
                              role="img"
                            />
                          </IndicatorTip>
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

function getSpecialtyThreatGrade(points: number): SpecialtyThreatGrade {
  if (points <= 3) return 'A';
  if (points <= 6) return 'B';
  if (points <= 9) return 'C';
  if (points <= 12) return 'D';
  if (points <= 15) return 'E';
  return 'F';
}

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
  matchId,
  isOwned = false,
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
  const ratingText = useTranslations('PublicUI.RatingsPitch');
  const specialtyThreatTooltip = (threat: Match120mSpecialtyThreatBreakdown) =>
    [
      uiText('seThreatBreakdownHeading'),
      threat.quick.points > 0 && uiText('seThreatBreakdownQuick', threat.quick),
      threat.head.points > 0 && uiText('seThreatBreakdownHead', threat.head),
      threat.unpredictable.points > 0 && uiText('seThreatBreakdownUnpredictable', threat.unpredictable),
      threat.technical.points > 0 && uiText('seThreatBreakdownTechnical', threat.technical),
      threat.powerful.points > 0 && uiText('seThreatBreakdownPowerful', threat.powerful),
      uiText('seThreatBreakdownTotal', { points: threat.total }),
    ]
      .filter(Boolean)
      .join('\n');
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [busySide, setBusySide] = React.useState<'home' | 'away' | null>(null);
  const [refreshedSide, setRefreshedSide] = React.useState<'home' | 'away' | null>(null);
  const refreshedTimer = React.useRef<number | null>(null);
  const [ratingsError, setRatingsError] = React.useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = React.useState(false);
  const actualDetailsExpanded = isOwned || detailsExpanded;
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
  const showRatingsSection = Boolean(
    (isOwned || ratingsPreview?.home || ratingsPreview?.away) && (ratingsPreview || ratingsSharedStatus),
  );

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
          matchNotice={
            !isOwned &&
            status === 'arranged' &&
            (ratingsSharedStatus?.[isRight ? 'away' : 'home'] === 'shared' ||
              ratingsPreview?.[isRight ? 'away' : 'home'])
              ? uiText('sharedPredictedRatings')
              : undefined
          }
        />
      )}
      {status === 'finished' && !actualDetailsExpanded && team.ratingGrade && (
        <button
          type="button"
          className={`${styles.ratingBadge} ${styles.compactRatingBadge} ${styles[`ratingGrade${normalizeMatch120mGrade(team.ratingGrade)[0]}`]}`}
          aria-label={`${team.name}: ${uiText('compactRating', { grade: normalizeMatch120mGrade(team.ratingGrade) })}. ${uiText('showRatings')}`}
          aria-expanded={actualDetailsExpanded}
          onClick={() => setDetailsExpanded(true)}
        >
          {uiText('compactRating', { grade: normalizeMatch120mGrade(team.ratingGrade) })}
        </button>
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
      data-fixture-id={matchId}
      className={`${styles.fixtureCard} ${isOwned ? styles.ownedFixture : ''} ${showRatingsSection ? styles.withRatingsPreview : ''} ${status === 'finished' ? styles.withFinishedDetails : ''}`}
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
        {status === 'finished' && !isOwned && (
          <button
            type="button"
            className={styles.detailsToggle}
            aria-expanded={actualDetailsExpanded}
            onClick={() => setDetailsExpanded((expanded) => !expanded)}
          >
            {actualDetailsExpanded ? uiText('hideRatings') : uiText('showRatings')}
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
      {showRatingsSection && (
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
            const predictedPerformance = preview ? predicted120mPerformance(preview) : null;
            const predictedAnalysis = predictedPerformance
              ? analyzeMatch120mCoaching(
                  predictedPerformance,
                  preview?.specialtyPositionsKnown && opposingPreview?.specialtyPositionsKnown
                    ? opposingPreview.specialtyPositions
                    : undefined,
                )
              : null;
            const predictedGrade = predictedAnalysis?.rating?.grade ?? null;
            const predictedThreat = preview
              ? calculateMatch120mSpecialtyThreatBreakdown(preview.specialtyPositions)
              : null;
            const predictedThreatGrade = getSpecialtyThreatGrade(predictedThreat?.total ?? 0);
            const predictedThreatTooltipId = `${matchId}-${side}-predicted-se-threat`;
            const predictedThreatTooltip = predictedThreat ? specialtyThreatTooltip(predictedThreat) : '';
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
                    {predictedGrade && (
                      <IndicatorTip
                        tone={`grade-${predictedGrade[0].toLowerCase()}`}
                        content={gradeAdvice(predictedAnalysis!, predictedGrade, (key, values) =>
                          ratingText(key as never, values as never),
                        )}
                      >
                        <span className={`${styles.ratingBadge} ${styles[`ratingGrade${predictedGrade[0]}`]}`}>
                          {uiText('predicted120mRating')} {predictedGrade}
                        </span>
                      </IndicatorTip>
                    )}
                    <RatingsPitch
                      ratings={preview.ratings}
                      analysis={predictedAnalysis!}
                      specialtyPositions={preview.specialtyPositions}
                      threatGrade={predictedThreatGrade}
                    />
                    <div className={styles.ratingsMetadata}>
                      <span>
                        {uiText('formation')}{' '}
                        <IndicatorTip
                          score={predictedAnalysis?.formationScore}
                          content={formationAdvice(preview.formation, (key) => ratingText(key as never))}
                        >
                          {preview.formation}
                        </IndicatorTip>
                      </span>
                      <span>
                        {uiText('tactic')}{' '}
                        <TacticValue
                          tactic={preview.tactic}
                          skill={preview.tacticSkill}
                          score={predictedAnalysis?.tacticScore ?? null}
                          tip={ratingText(
                            isCounterAttacks(preview.tactic)
                              ? 'counterAttacksPenalty'
                              : hasAdditionalTacticPenalty(preview.tactic)
                                ? 'attackingTacticPenalty'
                                : predictedAnalysis?.tacticScore === 1
                                  ? (preview.tacticSkill ?? 0) < 15
                                    ? 'pressingBelow15'
                                    : 'pressingBest'
                                  : 'aimPressing',
                          )}
                        />
                      </span>
                      <GameStyle
                        styleOfPlay={preview.coachModifier}
                        analysis={predictedAnalysis!}
                        text={(key) => ratingText(key as never)}
                      />
                      <span>
                        {uiText('setPiecesTaker')}{' '}
                        <IndicatorTip
                          score={predictedAnalysis?.setPiecesScore}
                          content={ratingText(
                            preview.setPiecesSkill === null
                              ? 'setPiecesNotSet'
                              : preview.setPiecesSkill <= 3
                                ? 'setPiecesBrilliant'
                                : preview.setPiecesSkill <= 7
                                  ? 'setPiecesGood'
                                  : 'aimSetPieces',
                          )}
                        >
                          {preview.setPieces}
                        </IndicatorTip>
                      </span>
                    </div>
                    {preview.specialtyPositionsKnown && (
                      <>
                        <div className={styles.specialtySummary} aria-label={uiText('playerSpecialtiesByPosition')}>
                          <span className={styles.specialtySummaryLabel}>{uiText('specialties')}</span>
                          {preview.specialtyPositions.map((group) => (
                            <span key={group.specialtyId}>
                              <strong>{specialtyPositionText(group)}</strong>
                            </span>
                          ))}
                        </div>
                        <div
                          className={`${styles.specialtyThreatPenalty} ${styles[`ratingGrade${predictedThreatGrade}`]}`}
                          role="note"
                          tabIndex={0}
                          data-tooltip-id={predictedThreatTooltipId}
                          data-tooltip-content={predictedThreatTooltip}
                          data-tooltip-tone={`grade-${predictedThreatGrade.toLowerCase()}`}
                        >
                          {uiText('seThreatPenalty', {
                            points: predictedThreat?.total ?? 0,
                            max: MATCH_120M_MAX_SE_THREAT_PENALTY,
                          })}
                        </div>
                        <Tooltip id={predictedThreatTooltipId} content="" />
                      </>
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
                      <div
                        className={`${styles.ratingsPreviewActions} ${side === 'away' ? styles.ratingsPreviewActionsAway : styles.ratingsPreviewActionsEdgeAligned}`}
                      >
                        <a
                          href={`https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=${opponent.managerHtId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          ✉️ {uiText('messageOpponent')}
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
            const opposingTeam = side === 'home' ? awayTeam : homeTeam;
            const performance = team.matchSummary?.eventDetails?.performance;
            const opposingPerformance = opposingTeam.matchSummary?.eventDetails?.performance;
            const taker = performance?.setPiecesTaker;
            const analysis = analyzeMatch120mCoaching(performance, opposingPerformance?.specialtyPositions);
            const displayedGrade = team.ratingGrade ? normalizeMatch120mGrade(team.ratingGrade) : null;
            const actualThreat = Array.isArray(performance?.specialtyPositions)
              ? calculateMatch120mSpecialtyThreatBreakdown(performance.specialtyPositions)
              : null;
            const actualThreatGrade = getSpecialtyThreatGrade(actualThreat?.total ?? 0);
            const actualThreatTooltipId = `${matchId}-${side}-actual-se-threat`;
            const actualThreatTooltip = actualThreat ? specialtyThreatTooltip(actualThreat) : '';
            return (
              <div key={side} className={`${styles.ratingsSide} ${side === 'away' ? styles.ratingsSideAway : ''}`}>
                <div className={styles.ratingsTeamHeading}>
                  {side === 'home' && <strong>{team.name}</strong>}
                  <span>{uiText('matchPerformance')}</span>
                  {side === 'away' && <strong>{team.name}</strong>}
                </div>
                {displayedGrade && (
                  <IndicatorTip
                    tone={`grade-${displayedGrade[0].toLowerCase()}`}
                    content={gradeAdvice(
                      analysis,
                      displayedGrade,
                      (key, values) => ratingText(key as never, values as never),
                      team.ratingScore,
                    )}
                  >
                    <span className={`${styles.ratingBadge} ${styles[`ratingGrade${displayedGrade[0]}`]}`}>
                      120m rating: {displayedGrade}
                    </span>
                  </IndicatorTip>
                )}
                <RatingsPitch
                  ratings={actualRatingsDisplay(performance)}
                  analysis={analysis}
                  specialtyPositions={performance?.specialtyPositions ?? []}
                  threatGrade={actualThreatGrade}
                  midfieldLabel="Midfield:"
                />
                <div className={styles.ratingsMetadata}>
                  <span>
                    {uiText('formation')}{' '}
                    <IndicatorTip
                      score={analysis.formationScore}
                      content={formationAdvice(performance?.formation ?? '', (key) => ratingText(key as never))}
                    >
                      {performance?.formation || '—'}
                    </IndicatorTip>
                  </span>
                  <span>
                    {uiText('tactic')}{' '}
                    <strong>
                      <TacticValue
                        tactic={performance?.tacticName}
                        skill={performance?.tacticSkill}
                        score={analysis.tacticScore}
                        tip={ratingText(
                          isCounterAttacks(performance?.tacticName)
                            ? 'counterAttacksPenalty'
                            : hasAdditionalTacticPenalty(performance?.tacticName)
                              ? 'attackingTacticPenalty'
                              : analysis.tacticScore === 1
                                ? (performance?.tacticSkill ?? 0) < 15
                                  ? 'pressingBelow15'
                                  : 'pressingBest'
                                : 'aimPressing',
                        )}
                      />
                    </strong>
                  </span>
                  <GameStyle
                    styleOfPlay={performance?.styleOfPlay}
                    analysis={analysis}
                    text={(key) => ratingText(key as never)}
                  />
                  <span>
                    {uiText('setPiecesTaker')}{' '}
                    <IndicatorTip
                      score={analysis.setPiecesScore}
                      content={ratingText(
                        taker?.skill === null
                          ? 'setPiecesNotSet'
                          : (taker?.skill ?? 99) <= 3
                            ? 'setPiecesBrilliant'
                            : (taker?.skill ?? 99) <= 7
                              ? 'setPiecesGood'
                              : 'aimSetPieces',
                      )}
                    >
                      {skillDisplay(taker?.skill)}
                    </IndicatorTip>
                  </span>
                </div>
                {Array.isArray(performance?.specialtyPositions) && (
                  <>
                    <div className={styles.specialtySummary} aria-label={uiText('playerSpecialtiesByPosition')}>
                      <span className={styles.specialtySummaryLabel}>{uiText('specialties')}</span>
                      {performance.specialtyPositions.map((group) => (
                        <span key={group.specialtyId}>
                          <strong>{specialtyPositionText(group)}</strong>
                        </span>
                      ))}
                    </div>
                    <div
                      className={`${styles.specialtyThreatPenalty} ${styles[`ratingGrade${actualThreatGrade}`]}`}
                      role="note"
                      tabIndex={0}
                      data-tooltip-id={actualThreatTooltipId}
                      data-tooltip-content={actualThreatTooltip}
                      data-tooltip-tone={`grade-${actualThreatGrade.toLowerCase()}`}
                    >
                      {uiText('seThreatPenalty', {
                        points: actualThreat?.total ?? 0,
                        max: MATCH_120M_MAX_SE_THREAT_PENALTY,
                      })}
                    </div>
                    <Tooltip id={actualThreatTooltipId} content="" />
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
};
