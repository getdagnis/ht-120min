import { useTranslations } from 'next-intl';
import React from 'react';
import { orderFixtureRounds } from '../../utils/organizer-round';
import { getRoundDisplayLabel, getRoundDisplayParts } from '../../../shared/round-display';
import { SectionCard } from '../../components/Card/SectionCard';
import { Button } from '../../components/Button/Button';
import { FixtureCard } from '../../components/FixtureCard/FixtureCard';
import { Modal } from '../../components/Modal/Modal';
import { ArrowClockwise, ArrowRight, CaretDown, CopySimple, Check, Question } from 'phosphor-react';
import { Tooltip } from '../Tooltip/Tooltip';
import { Switch } from '../Switch/Switch';
import { calculateMatchDate } from '../../utils/ht-data';
import { skillDisplay } from '../../utils/hattrick-skill';
import { getHattrickWeekDetails, getStockholmWallClock } from '../../utils/hattrick-calendar';
import { getImportedFixtureRoundPeriod } from '../../utils/manual-rounds';
import { getMatchDateForRound } from '../../utils/match-schedule';
import { isFixtureMisarranged } from '../../utils/fixture-status';
import { compareFixtures } from '../../utils/fixture-sorting';
import { useClientNow } from '../../hooks/useHydratedBrowserState';
import type { AppgOutcome } from '../../utils/appg';
import type { MatchEventDetails } from '../../../shared/match-events';
import { usesMatch120mRatings, type Match120mGrade } from '../../../shared/match-120m-rating';
import type { LiveMatchClock } from '../../../shared/live-match';
import { fixtureRatingNotice, type FixtureRatingShareStatus, type SharedFixtureRatings } from '../../types/fixture-ratings';
import styles from '../../legacy-pages/Public/TournamentView.module.sass';

export interface FixtureMatch {
  id: string;
  round_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  total_minutes: number;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  home_yellow_cards?: number;
  home_red_cards?: number;
  home_injuries?: number;
  away_yellow_cards?: number;
  away_red_cards?: number;
  away_injuries?: number;
  match_event_details?: MatchEventDetails | null;
  match_120m_ratings?: { side: 'home' | 'away'; team_id: string; score: number; grade: Match120mGrade; formula_version: number }[];
  home_match_kit_url?: string | null;
  away_match_kit_url?: string | null;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  ht_match_id: number | null;
  rating_share_statuses?: FixtureRatingShareStatus[];
  match_type: number | null;
  match_date?: Date;
  scheduled_for?: string | null;
  chpp_match_date?: string | null;
  kickoff_confirmed?: boolean;
  schedule_slot_type?: string | null;
  fixture_source?: string | null;
  reserve_replaces_team_id?: string | null;
  appg_outcome?: AppgOutcome | null;
  home_team: {
    name: string;
    active?: boolean;
    ht_team_id: number;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    manager_name?: string;
    hattrick_user_id?: number;
    reserve_active?: boolean;
    reserve_replacing_name?: string;
  } | null;
  away_team: {
    name: string;
    active?: boolean;
    ht_team_id: number;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    manager_name?: string;
    hattrick_user_id?: number;
    reserve_active?: boolean;
    reserve_replacing_name?: string;
  } | null;
}

function getFixtureDisplayTimeZone(match: Pick<FixtureMatch, 'ht_match_id' | 'schedule_slot_type' | 'fixture_source'>) {
  const isGeneratedFixture = match.fixture_source === 'generated' || Boolean(match.schedule_slot_type);
  return match.ht_match_id && !isGeneratedFixture ? 'Europe/Stockholm' : undefined;
}

interface FixturesViewProps {
  rounds: {
    id: string;
    round_number: number;
    round_source?: 'scheduled' | 'organizer';
    is_unscored?: boolean;
    created_at: string;
    phase?: 'regular' | 'postseason';
    phase_round_number?: number;
    phase_status?: 'pending' | 'materialized' | 'completed';
    reserved_slot_date?: string | null;
    reserved_slot_kind?: string | null;
    matches: FixtureMatch[];
  }[];
  season: number;
  upcomingRoundIndex: number;
  focusedRoundIndex: number;
  defaultVisibleRoundsCount: number;
  expandedRounds: Record<string, boolean>;
  toggleRound: (roundId: string) => void;
  onExpandAllRounds: () => void;
  onCollapseAllRounds: () => void;
  tournament: {
    id: string;
    scoring_mode?: string;
    name: string;
    slug: string;
    created_at: string;
    status?: string | null;
    schedule_mode?: string | null;
    last_fixtures_refresh: string | null;
  } | null;
  isRefreshingFixtures: boolean;
  handleRefreshFixtures: () => Promise<void>;
  onRatingsChanged: () => Promise<void>;
  copied: Record<string, boolean>;
  setCopied: (val: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  warnings: {
    team_id: string;
    round_id: string;
    type?: 'yellow' | 'red';
  }[];
  liveData: Record<
    string,
    {
      status: 'arranged' | 'ongoing' | 'finished';
      homeGoals: number;
      awayGoals: number;
      venue_mismatch?: boolean;
      home_yellow_cards?: number;
      home_red_cards?: number;
      home_injuries?: number;
      away_yellow_cards?: number;
      away_red_cards?: number;
      away_injuries?: number;
      match_event_details?: MatchEventDetails;
      home_match_kit_url?: string | null;
      away_match_kit_url?: string | null;
    } & Partial<LiveMatchClock>
  >;
  canJoinTournament: boolean;
  canJoinAnotherTeam?: boolean;
  isConnecting: boolean;
  canUpdateFixtures?: boolean;
  onJoinWithHattrick: () => void;
  isHistorical?: boolean;
  currentHtUserId?: number | null;
  onRatingsSignIn: () => void;
  availableSeasonNumbers?: number[];
  onSeasonChange?: (seasonNumber: number) => void;
  emptyStateMessage?: string;
}

const FIXTURE_CHALLENGE_PREVIEW_MATCH_ID = 'fixture-challenge-preview-match';
const HATTRICK_CHALLENGES_URL = 'https://www.hattrick.org/goto.ashx?path=/Club/Challenges/';
const fixtureChallengePreviewMode =
  process.env.NODE_ENV !== 'production' &&
  (process.env.NEXT_PUBLIC_FIXTURE_CHALLENGE_PREVIEW === '1' ||
    process.env.NEXT_PUBLIC_FIXTURE_CHALLENGE_PREVIEW === '2')
    ? process.env.NEXT_PUBLIC_FIXTURE_CHALLENGE_PREVIEW
    : null;

function ratingsDisplay(row: SharedFixtureRatings | undefined) {
  if (!row) return null;
  const format = (value: number) => Number(value).toFixed(2);
  return {
    fetchedAt: row.fetched_at,
    formation: row.formation,
    tactic: row.tactic,
    tacticSkill: row.tactic_skill,
    coachModifier: row.coach_modifier,
    setPieces: skillDisplay(row.set_pieces_skill),
    setPiecesSkill: row.set_pieces_skill,
    specialtyPositions: row.specialty_positions ?? [],
    specialtyPositionsKnown: Array.isArray(row.specialty_positions),
    ratings: {
      leftAttack: format(row.left_attack),
      centreAttack: format(row.centre_attack),
      rightAttack: format(row.right_attack),
      midfield: format(row.midfield),
      leftDefence: format(row.left_defence),
      centreDefence: format(row.centre_defence),
      rightDefence: format(row.right_defence),
    },
  };
}

interface PrivateFixtureRatings {
  fixtureId: string;
  ownedSides: Array<'home' | 'away'>;
  ratings: SharedFixtureRatings[];
}

export const FixturesView: React.FC<FixturesViewProps> = ({
  rounds,
  season,
  upcomingRoundIndex,
  focusedRoundIndex,
  defaultVisibleRoundsCount,
  expandedRounds,
  toggleRound,
  onExpandAllRounds,
  onCollapseAllRounds,
  tournament,
  isRefreshingFixtures,
  handleRefreshFixtures,
  onRatingsChanged,
  copied,
  setCopied,
  warnings,
  liveData,
  canJoinTournament,
  canJoinAnotherTeam = canJoinTournament,
  isConnecting,
  canUpdateFixtures = false,
  onJoinWithHattrick,
  isHistorical = false,
  currentHtUserId,
  onRatingsSignIn,
  availableSeasonNumbers = [],
  onSeasonChange,
  emptyStateMessage,
}) => {
  const uiText = useTranslations('PublicUI.FixturesView');
  type FixtureChallengeAvailability = {
    available: boolean;
    side?: 'home' | 'away';
    opponent?: { name: string; htTeamId: number };
    matchType?: 'cup_rules' | 'normal';
    venue?: 'home' | 'away';
    reason?: string;
    sent?: boolean;
  };
  type FixtureChallengeSelection = {
    matchType: 'cup_rules' | 'normal';
    venue: 'home' | 'away';
  };

  const nowMs = useClientNow(30_000);
  const [ratingsBoundaryNow, setRatingsBoundaryNow] = React.useState(0);
  React.useEffect(() => {
    const current = Date.now();
    const nextKickoff = Math.min(
      ...rounds.flatMap((round) =>
        round.matches
          .map((match) => (match.chpp_match_date ? new Date(match.chpp_match_date).getTime() : NaN))
          .filter((time) => Number.isFinite(time) && time > current),
      ),
    );
    if (!Number.isFinite(nextKickoff)) return;
    const timer = window.setTimeout(
      () => setRatingsBoundaryNow(Date.now()),
      Math.min(nextKickoff - current + 1, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [rounds, ratingsBoundaryNow]);
  const [privateRatingsState, setPrivateRatingsState] = React.useState<{
    tournamentId: string;
    userId: number;
    fixtures: Record<string, PrivateFixtureRatings>;
  } | null>(null);
  const [ratingsAuth, setRatingsAuth] = React.useState<
    'checking' | 'ready' | 'session-expired' | 'reconnect' | 'unavailable'
  >('checking');
  const [ratingsPromptDismissed, setRatingsPromptDismissed] = React.useState(false);
  const ratingsTournamentId = tournament?.id;
  const privateRatings =
    privateRatingsState &&
    !isHistorical &&
    privateRatingsState.tournamentId === ratingsTournamentId &&
    privateRatingsState.userId === currentHtUserId
      ? privateRatingsState.fixtures
      : {};
  const privateRatingsRequest = React.useRef(0);
  const fixtureText = useTranslations('fixtures');
  const [manualVisibleRoundsCount, setManualVisibleRoundsCount] = React.useState<number | null>(null);
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null);
  const [showMisarrangedMatches, setShowMisarrangedMatches] = React.useState(false);
  const [viewChoice, setViewChoice] = React.useState<{ context: string; view: 'mine' | 'all' } | null>(null);
  const [isTeamFilterOpen, setIsTeamFilterOpen] = React.useState(false);
  const teamFilterRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!isTeamFilterOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!teamFilterRef.current?.contains(event.target as Node)) setIsTeamFilterOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsTeamFilterOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isTeamFilterOpen]);
  const [challengeAvailability, setChallengeAvailability] = React.useState<
    Record<string, FixtureChallengeAvailability>
  >((): Record<string, FixtureChallengeAvailability> => {
    if (!fixtureChallengePreviewMode) return {};
    return {
      [FIXTURE_CHALLENGE_PREVIEW_MATCH_ID]: {
        available: true,
        side: 'home',
        opponent: { name: 'Preview Opponent FC', htTeamId: 900002 },
        matchType: 'cup_rules',
        venue: 'away',
      },
    };
  });
  const [challengeMatchId, setChallengeMatchId] = React.useState<string | null>(null);
  const [challengeError, setChallengeError] = React.useState<string | null>(null);
  const [isSendingChallenge, setIsSendingChallenge] = React.useState(false);
  const [challengeSuccess, setChallengeSuccess] = React.useState<string | null>(null);
  const [challengeSelection, setChallengeSelection] = React.useState<FixtureChallengeSelection | null>(null);
  const [autoArrangePreferences, setAutoArrangePreferences] = React.useState<
    Array<{
      teamId: string;
      teamName: string;
      enabled: boolean;
    }>
  >([]);
  const [autoArrangeLoading, setAutoArrangeLoading] = React.useState(false);
  const [autoArrangeSavingTeamId, setAutoArrangeSavingTeamId] = React.useState<string | null>(null);
  const [autoArrangeError, setAutoArrangeError] = React.useState<string | null>(null);
  const [ratingPreferences, setRatingPreferences] = React.useState<Array<{ teamId: string; teamName: string; enabled: boolean }>>([]);
  const [ratingPreferencesLoading, setRatingPreferencesLoading] = React.useState(false);
  const [ratingPreferenceSaving, setRatingPreferenceSaving] = React.useState<string | null>(null);
  const [ratingPreferenceError, setRatingPreferenceError] = React.useState<'load' | 'save' | null>(null);
  const [isSeasonMenuOpen, setIsSeasonMenuOpen] = React.useState(false);
  const seasonMenuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isSeasonMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSeasonMenuOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!seasonMenuRef.current?.contains(event.target as Node)) setIsSeasonMenuOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isSeasonMenuOpen]);

  React.useEffect(() => {
    if (isHistorical || !tournament?.id || !season || !currentHtUserId) {
      const timer = window.setTimeout(() => {
        setAutoArrangePreferences([]);
        setAutoArrangeLoading(false);
        setAutoArrangeError(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    const loadPreferences = async () => {
      setAutoArrangeLoading(true);
      setAutoArrangeError(null);
      try {
        const params = new URLSearchParams({
          route: 'auto-arrange-preferences',
          tournamentId: tournament.id,
          seasonNumber: String(season),
        });
        const response = await fetch(`/api/app?${params.toString()}`, { credentials: 'include' });
        const payload = (await response.json()) as {
          preferences?: Array<{ teamId: string; teamName: string; enabled: boolean }>;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || 'Could not load auto-arrange preferences.');
        if (!cancelled) setAutoArrangePreferences(payload.preferences || []);
      } catch (error) {
        if (!cancelled) {
          setAutoArrangePreferences([]);
          setAutoArrangeError(error instanceof Error ? error.message : 'Could not load auto-arrange preferences.');
        }
      } finally {
        if (!cancelled) setAutoArrangeLoading(false);
      }
    };
    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, [currentHtUserId, isHistorical, season, tournament?.id]);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setRatingPreferences([]);
      setRatingPreferenceError(null);
      if (isHistorical || !tournament?.id || !currentHtUserId) {
        setRatingPreferencesLoading(false);
        return;
      }
      setRatingPreferencesLoading(true);
      try {
        const params = new URLSearchParams({ route: 'rating-sharing-preferences', tournamentId: tournament.id });
        const response = await fetch(`/api/app?${params}`, { credentials: 'include', cache: 'no-store' });
        const payload = await response.json() as { preferences?: typeof ratingPreferences };
        if (!response.ok || !Array.isArray(payload.preferences)) throw new Error('Preference load failed');
        if (!cancelled) setRatingPreferences(payload.preferences);
      } catch {
        if (!cancelled) setRatingPreferenceError('load');
      } finally {
        if (!cancelled) setRatingPreferencesLoading(false);
      }
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [currentHtUserId, isHistorical, season, tournament?.id]);
  const currentRound = !isHistorical && upcomingRoundIndex >= 0 ? (rounds[upcomingRoundIndex] ?? null) : null;
  const focusedRound = !isHistorical && focusedRoundIndex >= 0 ? (rounds[focusedRoundIndex] ?? null) : null;
  const tournamentId = tournament?.id;
  const isOwnedMatch = React.useCallback((match: FixtureMatch) => Boolean(currentHtUserId) && (
    Number(match.home_team?.hattrick_user_id) === currentHtUserId ||
    Number(match.away_team?.hattrick_user_id) === currentHtUserId
  ), [currentHtUserId]);
  const hasMyTeam = rounds.some((round) => round.matches.some(isOwnedMatch));
  const ownedTeamIds = new Set(rounds.flatMap((round) => round.matches.flatMap((match) => [
    ...(currentHtUserId && Number(match.home_team?.hattrick_user_id) === currentHtUserId && match.home_team
      ? [match.home_team.ht_team_id] : []),
    ...(currentHtUserId && Number(match.away_team?.hattrick_user_id) === currentHtUserId && match.away_team
      ? [match.away_team.ht_team_id] : []),
  ])));
  const nextOwnedRound = !isHistorical ? orderFixtureRounds(rounds).find((round) => round.matches.some(
    (match) => isOwnedMatch(match) && !match.completed && match.status !== 'misarranged',
  )) : null;
  const viewContext = `${tournamentId}:${season}:${currentHtUserId ?? 'visitor'}`;
  const fixtureView = viewChoice?.context === viewContext ? viewChoice.view : hasMyTeam ? 'mine' : 'all';
  const selectView = (view: 'mine' | 'all') => {
    setViewChoice({ context: viewContext, view });
    setManualVisibleRoundsCount(null);
    setIsTeamFilterOpen(false);
  };
  const visibleRoundsCount = manualVisibleRoundsCount ?? defaultVisibleRoundsCount;
  const fixtureTeams = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    rounds.forEach((round) => {
      round.matches.forEach((match) => {
        if (match.home_team_id && match.home_team)
          byId.set(match.home_team_id, { id: match.home_team_id, name: match.home_team.name });
        if (match.away_team_id && match.away_team)
          byId.set(match.away_team_id, { id: match.away_team_id, name: match.away_team.name });
      });
    });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rounds]);
  const selectedTeamName = fixtureTeams.find((team) => team.id === selectedTeamId)?.name;
  const lastFinishedRoundNumber = React.useMemo(() => {
    let latestFinishedRoundNumber: number | null = null;

    for (const round of rounds) {
      if (round.phase_status === 'pending' || round.matches.length === 0) continue;
      const isFinished = round.matches.every((match) => match.completed || match.status === 'misarranged');
      if (isFinished) latestFinishedRoundNumber = round.round_number;
    }

    return latestFinishedRoundNumber;
  }, [rounds]);

  const challengeCandidateMatches = React.useMemo(
    () =>
      rounds.filter(round => round.phase_status === 'materialized' || round.id === currentRound?.id).flatMap(round => round.matches).filter((match) => {
        if (match.completed || (match.status && match.status !== 'not_arranged') || !currentHtUserId) return false;
        return (
          Number(match.home_team?.hattrick_user_id) === currentHtUserId ||
          Number(match.away_team?.hattrick_user_id) === currentHtUserId
        );
      }) || [],
    [currentHtUserId, currentRound, rounds],
  );
  const challengeCandidateKey = challengeCandidateMatches.map((match) => match.id).join(',');

  React.useEffect(() => {
    if (!tournamentId || !currentHtUserId || challengeCandidateMatches.length === 0) return;

    let cancelled = false;
    const loadChallengeAvailability = async () => {
      const results = await Promise.all(
        challengeCandidateMatches.map(async (match) => {
          try {
            const params = new URLSearchParams({ tournamentId, matchId: match.id });
            const response = await fetch(`/api/app?route=fixture-challenge&${params.toString()}`, {
              credentials: 'include',
            });
            const payload = (await response.json()) as FixtureChallengeAvailability;
            return [match.id, payload] as const;
          } catch {
            return [match.id, { available: false }] as const;
          }
        }),
      );
      if (cancelled) return;
      setChallengeAvailability((previous) => ({ ...previous, ...Object.fromEntries(results) }));
    };

    void loadChallengeAvailability();
    return () => {
      cancelled = true;
    };
  }, [challengeCandidateKey, challengeCandidateMatches, currentHtUserId, tournamentId]);

  const openChallengeConfirmation = React.useCallback(
    (matchId: string) => {
      const challenge = challengeAvailability[matchId];
      setChallengeError(null);
      setChallengeSuccess(null);
      setChallengeSelection({
        matchType: challenge?.matchType === 'normal' ? 'normal' : 'cup_rules',
        venue: challenge?.venue === 'away' ? 'away' : 'home',
      });
      setChallengeMatchId(matchId);
    },
    [challengeAvailability],
  );

  const closeChallengeConfirmation = React.useCallback(() => {
    if (isSendingChallenge) return;
    setChallengeMatchId(null);
    setChallengeError(null);
    setChallengeSuccess(null);
    setChallengeSelection(null);
  }, [isSendingChallenge]);

  const saveAutoArrangePreference = React.useCallback(
    async (enabled: boolean) => {
      if (!tournamentId || !autoArrangePreferences.length || autoArrangeSavingTeamId) return;
      setAutoArrangeSavingTeamId('all');
      setAutoArrangeError(null);
      try {
        for (const { teamId } of autoArrangePreferences) {
          const response = await fetch('/api/app?route=auto-arrange-preferences', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tournamentId, seasonNumber: season, teamId, enabled }),
          });
          const payload = (await response.json()) as { teamId?: string; enabled?: boolean; error?: string };
          if (!response.ok || payload.teamId !== teamId || typeof payload.enabled !== 'boolean') {
            throw new Error(payload.error || 'Could not save auto-arrange preference.');
          }
          setAutoArrangePreferences((previous) =>
            previous.map((preference) =>
              preference.teamId === teamId ? { ...preference, enabled: payload.enabled as boolean } : preference,
            ),
          );
        }
      } catch (error) {
        setAutoArrangeError(error instanceof Error ? error.message : 'Could not save auto-arrange preference.');
      } finally {
        setAutoArrangeSavingTeamId(null);
      }
    },
    [autoArrangePreferences, autoArrangeSavingTeamId, season, tournamentId],
  );

  const submitChallenge = React.useCallback(async () => {
    if (!tournamentId || !challengeMatchId || isSendingChallenge) return;

    if (challengeMatchId === FIXTURE_CHALLENGE_PREVIEW_MATCH_ID) {
      if (fixtureChallengePreviewMode === '1') {
        setChallengeSuccess('Challenge sent. Wait for Preview Opponent FC to accept.');
      } else {
        setChallengeError('Preview only: Hattrick rejected this challenge.');
      }
      return;
    }

    setIsSendingChallenge(true);
    setChallengeError(null);
    try {
      const response = await fetch('/api/app?route=fixture-challenge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId,
          matchId: challengeMatchId,
          matchType: challengeSelection?.matchType,
          venue: challengeSelection?.venue,
        }),
      });
      const payload = (await response.json()) as FixtureChallengeAvailability & { error?: string; message?: string };
      if (!response.ok || !payload.sent) {
        setChallengeError(payload.error || payload.reason || 'Hattrick could not send this challenge.');
        return;
      }
      setChallengeAvailability((previous) => ({
        ...previous,
        [challengeMatchId]: { ...previous[challengeMatchId], ...payload, sent: true },
      }));
      setChallengeSuccess(
        `Challenge sent. Wait for ${payload.opponent?.name || challengeAvailability[challengeMatchId]?.opponent?.name || 'your opponent'} to accept.`,
      );
    } catch {
      setChallengeError('Could not contact Hattrick. Please try again.');
    } finally {
      setIsSendingChallenge(false);
    }
  }, [challengeAvailability, challengeMatchId, challengeSelection, isSendingChallenge, tournamentId]);

  const selectedChallenge = challengeMatchId ? challengeAvailability[challengeMatchId] : null;
  const selectedChallengeSelection: FixtureChallengeSelection = challengeSelection || {
    matchType: selectedChallenge?.matchType === 'normal' ? 'normal' : 'cup_rules',
    venue: selectedChallenge?.venue === 'away' ? 'away' : 'home',
  };
  const seasonOptions = React.useMemo(
    () => [...new Set([season, ...availableSeasonNumbers])].sort((a, b) => b - a),
    [availableSeasonNumbers, season],
  );

  const resolveMatchDate = React.useCallback(
    (round: { created_at: string; round_number: number }, match: FixtureMatch) =>
      getMatchDateForRound(round, match, match.home_team?.country_name) ||
      match.match_date ||
      calculateMatchDate(round.created_at, round.round_number, match.home_team?.country_name),
    [],
  );

  const reloadPrivateRatings = React.useCallback(async () => {
    const request = ++privateRatingsRequest.current;
    if (!ratingsTournamentId || !currentHtUserId || isHistorical) return;
    try {
      const response = await fetch(
        `/api/app?route=fixture-ratings&tournamentId=${encodeURIComponent(ratingsTournamentId)}`,
        {
          cache: 'no-store',
          credentials: 'include',
        },
      );
      const body = (await response.json().catch(() => null)) as {
        fixtures?: PrivateFixtureRatings[];
        error?: string;
      } | null;
      if (!response.ok) {
        if (request === privateRatingsRequest.current) {
          setPrivateRatingsState(null);
          setRatingsAuth(
            response.status === 401 && body?.error === 'Please sign in with Hattrick first.'
              ? 'session-expired'
              : body?.error && /authorization|reauthorize|sign in again/i.test(body.error)
                ? 'reconnect'
                : 'unavailable',
          );
        }
        return;
      }
      if (request === privateRatingsRequest.current) {
        setPrivateRatingsState({
          tournamentId: ratingsTournamentId,
          userId: currentHtUserId,
          fixtures: Object.fromEntries((body?.fixtures || []).map((entry) => [entry.fixtureId, entry])),
        });
        setRatingsAuth('ready');
      }
    } catch {
      if (request === privateRatingsRequest.current) {
        setPrivateRatingsState(null);
        setRatingsAuth('unavailable');
      }
    }
  }, [ratingsTournamentId, currentHtUserId, isHistorical]);

  // Background refresh may publish the first prediction or withdraw a notice.
  // Reload private values only when the narrow public sharing status changes.
  const ratingsShareKey = rounds.flatMap((round) => round.matches.flatMap((match) =>
    (match.rating_share_statuses || []).map((share) => `${share.fixture_id}:${share.team_id}:${share.ht_match_id}:${share.shared}`),
  )).sort().join(',');

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void reloadPrivateRatings();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      privateRatingsRequest.current += 1;
    };
  }, [reloadPrivateRatings, ratingsShareKey]);

  const saveRatingPreference = async (enabled: boolean) => {
    if (!tournamentId || ratingPreferenceSaving) return;
    setRatingPreferenceSaving('all');
    setRatingPreferenceError(null);
    let saved = false;
    try {
      for (const { teamId } of ratingPreferences) {
        const response = await fetch('/api/app?route=rating-sharing-preferences', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId, teamId, enabled }),
        });
        const payload = await response.json() as { teamId?: string; enabled?: boolean };
        if (!response.ok || payload.teamId !== teamId || typeof payload.enabled !== 'boolean') throw new Error('Preference save failed');
        setRatingPreferences((current) => current.map((preference) =>
          preference.teamId === teamId ? { ...preference, enabled: payload.enabled as boolean } : preference));
        saved = true;
        // Discard withdrawn values immediately, even if the subsequent reload fails.
        if (!enabled) {
          privateRatingsRequest.current += 1;
          setPrivateRatingsState(null);
        }
      }
    } catch {
      setRatingPreferenceError('save');
    } finally {
      // Reload after any successful write, including a partially failed batch.
      if (saved) {
        await onRatingsChanged().catch(() => {});
        await reloadPrivateRatings();
      }
      setRatingPreferenceSaving(null);
    }
  };

  const updateRatings = async (fixtureId: string, side: 'home' | 'away', action: 'share' | 'update' | 'remove') => {
    const response = await fetch('/api/app?route=fixture-ratings', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixtureId, side, action }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      if (response.status === 401 && body?.error === 'Please sign in with Hattrick first.') {
        setPrivateRatingsState(null);
        setRatingsAuth('session-expired');
      } else if (body?.error && /authorization|reauthorize|sign in again/i.test(body.error)) {
        setPrivateRatingsState(null);
        setRatingsAuth('reconnect');
      }
      throw new Error(body?.error || 'Could not update shared ratings.');
    }
    await onRatingsChanged();
    await reloadPrivateRatings();
  };

  const refreshFixturesAndRatings = async () => {
    await handleRefreshFixtures();
    await reloadPrivateRatings();
  };

  const visibleWarnings = React.useMemo(() => {
    const roundStartTimes = rounds.map((round) => {
      const matchStarts = round.matches
        .filter((match) => match.home_team && match.away_team)
        .map((match) => resolveMatchDate(round, match).getTime())
        .filter(Number.isFinite);
      if (matchStarts.length > 0) return Math.min(...matchStarts);
      return round.reserved_slot_date ? new Date(round.reserved_slot_date).getTime() : null;
    });

    return warnings.filter((warning) => {
      const warningRoundIndex = rounds.findIndex((round) => round.id === warning.round_id);
      if (warningRoundIndex < 0 || nowMs <= 0) return true;
      return !roundStartTimes
        .slice(warningRoundIndex + 1)
        .some((roundStart) => roundStart !== null && roundStart <= nowMs);
    });
  }, [nowMs, resolveMatchDate, rounds, warnings]);
  const filteredRounds = React.useMemo(() => {
    const result = rounds.map((round) => ({
      ...round,
      matches: round.matches.map((match) => {
        const hasWarnings = visibleWarnings.some((warning) => warning.round_id === round.id && (
          (warning.team_id === match.home_team_id && !(match.reserve_replaces_team_id === match.home_team_id && match.home_team?.reserve_active === true)) ||
          (warning.team_id === match.away_team_id && !(match.reserve_replaces_team_id === match.away_team_id && match.away_team?.reserve_active === true))
        ));
        return { ...match, status: isFixtureMisarranged(match.status, match.completed, hasWarnings) ? 'misarranged' as const : match.status };
      }).sort(compareFixtures).filter((match) =>
        (showMisarrangedMatches || match.status !== 'misarranged') &&
        (fixtureView === 'mine'
          ? isOwnedMatch(match)
          : !selectedTeamId || match.home_team_id === selectedTeamId || match.away_team_id === selectedTeamId),
      ),
    })).filter((round) => round.matches.length > 0 || (fixtureView === 'all' && !selectedTeamId));
    if (fixtureView === 'mine') {
      const finished = (round: typeof result[number]) => round.matches.every((match) => match.completed || match.status === 'misarranged');
      const chronological = orderFixtureRounds(result);
      const position = new Map(chronological.map((round, index) => [round.id, index]));
      result.sort((a, b) => Number(finished(a)) - Number(finished(b)) || (finished(a) ? position.get(b.id)! - position.get(a.id)! : position.get(a.id)! - position.get(b.id)!));
    }
    return result;
  }, [rounds, fixtureView, selectedTeamId, showMisarrangedMatches, isOwnedMatch, visibleWarnings]);
  const showRatingsAuthPrompt =
    !isHistorical &&
    Boolean(currentHtUserId) &&
    !ratingsPromptDismissed &&
    (ratingsAuth === 'session-expired' || ratingsAuth === 'reconnect') &&
    rounds.some((round) =>
      round.matches.some(
        (match) =>
          match.status === 'arranged' &&
          !match.completed &&
          Boolean(match.ht_match_id) &&
          Boolean(match.scheduled_for && new Date(match.scheduled_for).getTime() > nowMs) &&
          [match.home_team, match.away_team].some((team) => Number(team?.hattrick_user_id) === currentHtUserId),
      ),
    );

  return (
    <div className={styles.rounds}>
      <div className={styles.fixturesHeader}>
        <div className={styles.fixturesHeaderControls}>
          <div ref={seasonMenuRef} className={styles.fixturesSeasonMenu}>
            {seasonOptions.length > 1 ? (
              <Button
                variant="zero"
                size="sm"
                className={styles.fixturesTitle}
                onClick={() => setIsSeasonMenuOpen((open) => !open)}
                aria-expanded={isSeasonMenuOpen}
                aria-haspopup="listbox"
              >
                {uiText('seasonFixtures', { season })}
                <CaretDown size={16} weight="bold" aria-hidden="true" />
              </Button>
            ) : (
              <h3 className={styles.fixturesTitle}>{uiText('seasonFixtures', { season })}</h3>
            )}
            {isSeasonMenuOpen && seasonOptions.length > 1 && (
              <div className={styles.fixturesSeasonDropdown} role="listbox" aria-label={uiText('selectSeason')}>
                {seasonOptions.map((seasonNumber) => (
                  <button
                    key={seasonNumber}
                    type="button"
                    className={styles.fixturesSeasonOption}
                    aria-selected={seasonNumber === season}
                    onClick={() => {
                      setIsSeasonMenuOpen(false);
                      onSeasonChange?.(seasonNumber);
                    }}
                  >
                    {uiText('seasonNumber', { season: seasonNumber })}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!isHistorical && (autoArrangePreferences.length > 0 || ratingPreferences.length > 0) && (
            <div className={styles.autoArrangePreferences}>
              {autoArrangePreferences.length > 0 && (
                <div className={styles.autoArrangeControl}>
                  <Switch
                    checked={autoArrangePreferences.some((preference) => preference.enabled)}
                    onChange={(enabled) => void saveAutoArrangePreference(enabled)}
                    disabled={autoArrangeLoading || autoArrangeSavingTeamId !== null}
                    size="sm"
                    label={fixtureText(autoArrangePreferences.some((preference) => preference.enabled)
                      ? 'autoArrangeMyFixtures' : 'autoArrangeMyFixturesDisabled')}
                  />
                  <Tooltip id="auto-arrange-my-teams" content={fixtureText('autoArrangeTooltip')}>
                    <span className={styles.autoArrangeInfo} tabIndex={0} aria-label={fixtureText('autoArrangeTooltip')}>
                      <Question size={16} weight="bold" aria-hidden="true" />
                    </span>
                  </Tooltip>
                </div>
              )}
              {ratingPreferences.length > 0 && (
                <div className={styles.autoArrangeControl}>
                  <Switch
                    checked={ratingPreferences.some((preference) => preference.enabled)}
                    onChange={(enabled) => void saveRatingPreference(enabled)}
                    disabled={ratingPreferencesLoading || ratingPreferenceSaving !== null}
                    size="sm"
                    label={fixtureText('autoShareMyRatings')}
                  />
                  <Tooltip id="auto-share-my-teams" content={fixtureText('autoShareRatingsTooltip')}>
                    <span className={styles.autoArrangeInfo} tabIndex={0} aria-label={fixtureText('autoShareRatingsTooltip')}>
                      <Question size={16} weight="bold" aria-hidden="true" />
                    </span>
                  </Tooltip>
                </div>
              )}
            </div>
          )}
          {autoArrangeError && !isHistorical && (
            <p className={styles.autoArrangeError} role="status">
              {autoArrangeError}
            </p>
          )}
          {ratingPreferenceError && !isHistorical && (
            <p className={styles.autoArrangeError} role="status">
              {fixtureText(ratingPreferenceError === 'load' ? 'autoShareRatingsLoadError' : 'autoShareRatingsSaveError')}
            </p>
          )}
        </div>
        {(seasonOptions.length > 1 || rounds.length > 0) && (
          <div className={styles.fixturesHeaderActions}>
            {rounds.length > 0 && fixtureView === 'all' && (
              <div className={styles.fixturesFilterMenu} ref={teamFilterRef}>
                <button
                  type="button"
                  className={`${styles.fixturesHeaderAction} ${styles.fixturesFilterButton}`}
                  onClick={() => setIsTeamFilterOpen((open) => !open)}
                  aria-expanded={isTeamFilterOpen}
                  aria-haspopup="listbox"
                >
                  <span>
                    {uiText('fILTER')} {selectedTeamName || uiText('aLLTEAMS')}
                  </span>
                </button>
                {isTeamFilterOpen && (
                  <div
                    className={styles.fixturesFilterDropdown}
                    role="listbox"
                    aria-label={uiText('filterFixturesByTeam')}
                  >
                    <button
                      type="button"
                      className={styles.fixturesFilterOption}
                      aria-selected={selectedTeamId === null}
                      onClick={() => {
                        setSelectedTeamId(null);
                        setManualVisibleRoundsCount(null);
                        setIsTeamFilterOpen(false);
                      }}
                    >
                      {uiText('aLLTEAMS')}
                    </button>
                    {fixtureTeams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        className={styles.fixturesFilterOption}
                        aria-selected={selectedTeamId === team.id}
                        onClick={() => {
                          setSelectedTeamId(team.id);
                          setManualVisibleRoundsCount(null);
                          setIsTeamFilterOpen(false);
                        }}
                      >
                        {team.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {rounds.length > 0 && (
              <button
                type="button"
                className={styles.fixturesHeaderAction}
                aria-pressed={showMisarrangedMatches}
                onClick={() => setShowMisarrangedMatches((show) => !show)}
              >
                <span>{uiText(showMisarrangedMatches ? 'showMisarrangedOn' : 'showMisarrangedOff')}</span>
              </button>
            )}
            {rounds.length > 0 && (
              <button type="button" className={styles.fixturesHeaderAction} onClick={onExpandAllRounds}>
                <span>{uiText('eXPANDALL')}</span>
              </button>
            )}
            {rounds.length > 0 && (
              <Tooltip id="collapse-tooltip" content="Collapse all except active" className="tooltip">
                <button type="button" className={styles.fixturesHeaderAction} onClick={onCollapseAllRounds}>
                  <span>{uiText('cOLLAPSEALL')}</span>
                </button>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {showRatingsAuthPrompt && (
        <div className={styles.ratingsAuthPrompt} role="status">
          <p>
            {ratingsAuth === 'session-expired'
              ? uiText('yourHT120minSessionExpiredSignInWithHattrick')
              : uiText('hattrickAuthorizationIsMissingOrWasDeniedReconnectHattrick')}
          </p>
          <div>
            <Button size="sm" variant="secondary" onClick={onRatingsSignIn}>
              {ratingsAuth === 'session-expired' ? uiText('signInWithHattrick') : uiText('reconnectHattrick')}
            </Button>
            <Button size="sm" variant="zero" onClick={() => setRatingsPromptDismissed(true)}>
              {uiText('continueBrowsing')}
            </Button>
          </div>
        </div>
      )}

      {rounds.length === 0 && (
        <SectionCard title={uiText('fixturesResults')}>
          <div className={`${styles.emptyFixtures} ${styles.registrationStatus}`}>
            <p>{emptyStateMessage || uiText('fixturesHaveNotYetBeenGeneratedTournamentIsOpen')}</p>
            {canJoinAnotherTeam && <span>{uiText('youCanJoinWithAnotherTeam')}</span>}
            {(canJoinTournament || canJoinAnotherTeam) && (
              <Button
                variant="primary"
                size="sm"
                className={styles.joinButton}
                onClick={onJoinWithHattrick}
                disabled={isConnecting}
              >
                <ArrowRight size={18} weight="bold" />{' '}
                {isConnecting ? uiText('connectingToHattrick') : uiText('joinWithHattrick')}
              </Button>
            )}
          </div>
        </SectionCard>
      )}

      {rounds.length > 0 && (
        <div className={styles.fixturesHeaderControls} role="group" aria-label={uiText('matchView')}>
          <Button size="sm" variant={fixtureView === 'mine' ? 'primary' : 'secondaryAction'} disabled={!currentHtUserId} aria-pressed={fixtureView === 'mine'} onClick={() => selectView('mine')}>{uiText('myMatches')}</Button>
          <Button size="sm" variant={fixtureView === 'all' ? 'primary' : 'secondaryAction'} aria-pressed={fixtureView === 'all'} onClick={() => selectView('all')}>{uiText('allMatches')}</Button>
        </div>
      )}
      {rounds.length > 0 && filteredRounds.length === 0 && <p role="status">{uiText('noPersonalMatches')}</p>}
      {filteredRounds.slice(0, visibleRoundsCount).map((round, roundIndex) => {
        const isNextRound = round.id === currentRound?.id;
        const isFocusedRound = round.id === focusedRound?.id;
        const isPendingRound = round.phase_status === 'pending';

        const isExpanded = expandedRounds[round.id] ?? (fixtureView === 'all'
          ? isFocusedRound
          : isHistorical || round.matches.some(match => !match.completed && match.status !== 'misarranged') || round.round_number === lastFinishedRoundNumber);

        const allFinished =
          !isPendingRound &&
          round.matches.length > 0 &&
          round.matches.every((m) => m.completed || m.status === 'misarranged');
        const startsPreviousMatches = fixtureView === 'mine' && allFinished && (
          roundIndex === 0 || filteredRounds[roundIndex - 1].matches.some(
            (match) => !match.completed && match.status !== 'misarranged',
          )
        );

        const nextRound = filteredRounds[filteredRounds.findIndex((r) => r.id === round.id) + 1];

        const roundDate = round.matches[0]
          ? resolveMatchDate(round, round.matches[0])
          : round.reserved_slot_date
            ? new Date(round.reserved_slot_date)
            : null;
        const roundTimeZone = round.matches[0] ? getFixtureDisplayTimeZone(round.matches[0]) : undefined;
        const roundWeek = roundDate ? getHattrickWeekDetails(roundDate) : null;
        const roundPeriod = roundDate ? getImportedFixtureRoundPeriod(roundDate) : null;
        const currentRoundStartsAt = roundDate ? getStockholmWallClock(roundDate) : null;
        if (currentRoundStartsAt) {
          // Tuesday at 06:00 in the round's Hattrick calendar week.
          const daysSinceMonday = (currentRoundStartsAt.getUTCDay() + 6) % 7;
          currentRoundStartsAt.setUTCDate(currentRoundStartsAt.getUTCDate() - daysSinceMonday + 1);
          currentRoundStartsAt.setUTCHours(6, 0, 0, 0);
        }
        const isCurrentRound = nowMs > 0 && currentRoundStartsAt !== null &&
          getStockholmWallClock(new Date(nowMs)).getTime() >= currentRoundStartsAt.getTime();
        const roundTitleKey = !isHistorical && isFocusedRound && !allFinished
          ? isCurrentRound ? 'currentRoundNumber' : 'nextRoundNumber'
          : !isHistorical && allFinished && round.round_number === lastFinishedRoundNumber
            ? 'lastRoundNumber'
            : 'roundNumber';
        const displayRound = getRoundDisplayParts(round, rounds);

        const formatMatch = (m: FixtureMatch, isNext: boolean) => {
          const hasPenaltyShootout =
            m.completed &&
            m.went_120 &&
            m.penalty_shootout_home_goals !== null &&
            m.penalty_shootout_away_goals !== null;
          const matchDate = resolveMatchDate(round, m);
          const value = isNext
            ? `${matchDate.toLocaleDateString('lv-LV', {
                day: '2-digit',
                month: '2-digit',
                timeZone: getFixtureDisplayTimeZone(m),
              })}`
            : m.completed
              ? `${m.home_goals} : ${m.away_goals}${hasPenaltyShootout ? ` (${m.penalty_shootout_home_goals}:${m.penalty_shootout_away_goals})` : ''}${m.went_120 ? " 🎯 120'!" : ''}`
              : m.status === 'misarranged'
                ? 'DNP'
                : `${matchDate.toLocaleDateString('lv-LV', {
                    day: '2-digit',
                    month: '2-digit',
                    timeZone: getFixtureDisplayTimeZone(m),
                  })}.`;

          return `[tr][td]${m.home_team?.name}[/td][td][b]${value}[/b][/td][td]${m.away_team?.name}[/td][/tr]`;
        };

        const handleCopy = () => {
          let table = `[b]${tournament?.name}[/b]\n[link=http://ht-120min.vercel.app/t/${tournament?.slug}]\n\n[b]${getRoundDisplayLabel(round, rounds).toUpperCase()}, ${allFinished ? 'final results:[/b]' : 'Fixtures:[/b]'}\n[table]${round.matches
            .map((m) => formatMatch(m, !m.completed && m.status !== 'misarranged'))
            .join(' ')}[/table]`;

          if (nextRound) {
            table += `\n[b]Next: ${getRoundDisplayLabel(nextRound, rounds).toUpperCase()}, fixtures:[/b]\n[table]${nextRound.matches.map((m) => formatMatch(m, true)).join(' ')}[/table]`;
          }
          table += `\nFull fixtures: [link=http://ht-120min.vercel.app/t/${tournament?.slug}?tab=fixtures]`;
          navigator.clipboard.writeText(table);
          setCopied((prev) => ({ ...prev, [round.id]: true }));
          setTimeout(() => setCopied((prev) => ({ ...prev, [round.id]: false })), 2000);
        };

        return (
          <div key={round.id} data-round-id={round.id} className={startsPreviousMatches ? styles.previousMatches : undefined}>
            {startsPreviousMatches && (
              <h3 className={styles.personalMatchTitle}>{uiText('yourPreviousMatches')}</h3>
            )}
            <SectionCard
              highlighted={isFocusedRound}
              collapsible
              isCollapsed={!isExpanded}
              onToggleCollapse={() => toggleRound(round.id)}
              title={
                <div className={styles.roundHeader}>
                  <>
                    <span>
                      {uiText(roundTitleKey, { round: `${displayRound.number}${displayRound.suffix}` })}{round.is_unscored === true && ' · Unscored'}
                      {round.phase === 'postseason'
                        ? uiText(
                            rounds.filter(
                              (item) => item.phase === 'postseason' && item.round_number > round.round_number,
                            ).length === 2
                              ? 'playoffQuarterfinals'
                              : rounds.filter(
                                    (item) => item.phase === 'postseason' && item.round_number > round.round_number,
                                  ).length === 1
                                ? 'playoffSemifinals'
                                : 'championshipFinal',
                          )
                        : ''}
                    </span>
                    {roundDate && roundWeek && (
                      <span className={styles.roundDate}>
                        {uiText('htWeekNumber', { week: roundWeek.htWeek })}
                        {roundPeriod !== 'full_week'
                          ? ` ${roundPeriod === 'weekend' ? uiText('midweekOrWeekendWeekend') : ''}`
                          : ''}{' '}
                        •{' '}
                        {roundDate.toLocaleDateString('lv-LV', {
                          timeZone: roundTimeZone,
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </span>
                    )}
                  </>
                </div>
              }
              headerRight={
                !isHistorical && (allFinished || isNextRound) ? (
                  <div className={styles.fixturesControls} onClick={(e) => e.stopPropagation()}>
                    {allFinished || tournament?.status === 'finished' ? (
                      <>
                        {tournament?.status !== 'finished' && tournament?.schedule_mode === 'length' &&
                          rounds.some((next) => next.round_number === round.round_number + 1 && next.phase_status === 'pending') && (
                            <button
                              type="button"
                              className={`${styles.refreshBtn} ${isRefreshingFixtures ? styles.spinning : ''}`}
                              onClick={refreshFixturesAndRatings}
                              disabled={isRefreshingFixtures}
                              aria-label="Refresh results and advance the next round"
                              title="Refresh results and advance the next round"
                            >
                              <ArrowClockwise size={18} />
                            </button>
                          )}
                        <span className={styles.lastRefresh}>
                          <div className="hideOnMobile">{uiText('copyForHTForums')}</div>
                        </span>
                        <button
                          className={styles.refreshBtn}
                          onClick={handleCopy}
                          data-tooltip-id={`copy-tooltip-${round.id}`}
                        >
                          {copied[round.id] ? <Check size={18} color="green" /> : <CopySimple size={18} />}
                        </button>
                        <Tooltip
                          id={`copy-tooltip-${round.id}`}
                          content={copied[round.id] ? 'HT forum table copied!' : 'Copy for HT forums'}
                          className="tooltip"
                        />
                      </>
                    ) : (
                      <>
                        {isNextRound && tournament?.last_fixtures_refresh && (
                          <span className={styles.lastRefresh}>
                            <span className="hideOnMobile">
                              {isRefreshingFixtures ? uiText('checking') : uiText('lastChecked')}
                              {!isRefreshingFixtures &&
                                new Date(tournament.last_fixtures_refresh).toLocaleTimeString('en-GB', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  timeZone: 'Europe/Riga',
                                })}
                            </span>
                          </span>
                        )}
                        <button
                          className={`${styles.refreshBtn} ${isRefreshingFixtures ? styles.spinning : ''}`}
                          onClick={refreshFixturesAndRatings}
                          disabled={isRefreshingFixtures}
                          data-tooltip-id="refresh-tooltip"
                        >
                          <ArrowClockwise size={18} />
                        </button>
                        <Tooltip id="refresh-tooltip" content="Refresh results" className="tooltip" />
                        <button className={styles.refreshBtn} onClick={handleCopy} data-tooltip-id="copy-tooltip">
                          {copied[round.id] ? <Check size={18} color="green" /> : <CopySimple size={18} />}
                        </button>
                        <Tooltip
                          id="copy-tooltip"
                          content={copied[round.id] ? 'HT forum table copied!' : 'Copy for HT forums'}
                          className="tooltip"
                        />
                      </>
                    )}
                  </div>
                ) : undefined
              }
            >
              {isExpanded && (
                <div className={styles.matchesGrid}>
                  {fixtureView === 'mine' && round.id === nextOwnedRound?.id && (
                    <h3 className={styles.personalMatchTitle}>
                      {uiText(ownedTeamIds.size > 1 ? 'nextRoundMatchesForYourTeams' : 'yourNextMatch')}
                    </h3>
                  )}
                  {isPendingRound && (
                    <div className={`${styles.emptyFixtures} ${styles.registrationStatus}`}>
                      <p>
                        {round.phase === 'postseason'
                          ? uiText('playoffPairingsAreGeneratedAfterThePreviousRound')
                          : uiText('pairingsAreGeneratedAfterRound', {
                              round: round.round_number - 1,
                            })}
                      </p>
                    </div>
                  )}
                  {round.matches.map((match) => {
                    const matchDate = resolveMatchDate(round, match);

                    const day = matchDate
                      .toLocaleString('en-GB', {
                        weekday: 'short',
                        timeZone: getFixtureDisplayTimeZone(match),
                      })
                      .toUpperCase();
                    const datePart = matchDate.toLocaleDateString('lv-LV', {
                      day: '2-digit',
                      month: '2-digit',
                      timeZone: getFixtureDisplayTimeZone(match),
                    });
                    const timePart = matchDate.toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                      timeZone: getFixtureDisplayTimeZone(match),
                    });
                    const formattedDate = `${day} / ${datePart} / ${timePart}`;

                    const homeDisplaysReserve =
                      match.reserve_replaces_team_id === match.home_team_id && match.home_team?.reserve_active === true;
                    const awayDisplaysReserve =
                      match.reserve_replaces_team_id === match.away_team_id && match.away_team?.reserve_active === true;
                    const homeWarning = homeDisplaysReserve
                      ? undefined
                      : visibleWarnings.find((w) => w.team_id === match.home_team_id && w.round_id === round.id);
                    const awayWarning = awayDisplaysReserve
                      ? undefined
                      : visibleWarnings.find((w) => w.team_id === match.away_team_id && w.round_id === round.id);

                    // Use status from DB, fallback to simple detection
                    const liveMatch =
                      !isHistorical && match.ht_match_id ? liveData[match.ht_match_id.toString()] : null;
                    let status = match.status || 'not_arranged';
                    const isMisarranged = isFixtureMisarranged(
                      status,
                      match.completed,
                      Boolean(homeWarning || awayWarning),
                    );
                    const now = new Date(nowMs);
                    const hasConfirmedKickoff = Boolean(match.kickoff_confirmed || match.chpp_match_date);
                    const isPastStartTime = hasConfirmedKickoff && match.match_date && now >= match.match_date;
                    const isWithinLiveWindow =
                      hasConfirmedKickoff &&
                      match.match_date &&
                      now.getTime() < match.match_date.getTime() + 4 * 60 * 60 * 1000;

                    if (isMisarranged) {
                      status = 'misarranged';
                    } else if (match.completed) {
                      status = 'finished';
                    } else if (liveMatch) {
                      status = liveMatch.status;
                    } else if (!isHistorical && isPastStartTime && isWithinLiveWindow && status === 'arranged') {
                      status = 'ongoing';
                    }

                    const currentScore = liveMatch
                      ? { home: liveMatch.homeGoals, away: liveMatch.awayGoals }
                      : match.completed
                        ? { home: match.home_goals || 0, away: match.away_goals || 0 }
                        : status === 'ongoing' && match.home_goals !== null && match.away_goals !== null
                          ? { home: match.home_goals, away: match.away_goals }
                          : !isHistorical && isPastStartTime && isWithinLiveWindow
                            ? { home: 0, away: 0 }
                            : undefined;
                    const isPostponed =
                      !isHistorical && tournament?.status === 'paused' && !match.completed && status !== 'misarranged';
                    const homeSummary = liveMatch
                      ? {
                          yellowCards: liveMatch.home_yellow_cards ?? match.home_yellow_cards ?? 0,
                          redCards: liveMatch.home_red_cards ?? match.home_red_cards ?? 0,
                          injuries: liveMatch.home_injuries ?? match.home_injuries ?? 0,
                          eventDetails: liveMatch.match_event_details?.home ?? match.match_event_details?.home ?? null,
                        }
                      : {
                          yellowCards: match.home_yellow_cards ?? 0,
                          redCards: match.home_red_cards ?? 0,
                          injuries: match.home_injuries ?? 0,
                          eventDetails: match.match_event_details?.home ?? null,
                        };
                    const awaySummary = liveMatch
                      ? {
                          yellowCards: liveMatch.away_yellow_cards ?? match.away_yellow_cards ?? 0,
                          redCards: liveMatch.away_red_cards ?? match.away_red_cards ?? 0,
                          injuries: liveMatch.away_injuries ?? match.away_injuries ?? 0,
                          eventDetails: liveMatch.match_event_details?.away ?? match.match_event_details?.away ?? null,
                        }
                      : {
                          yellowCards: match.away_yellow_cards ?? 0,
                          redCards: match.away_red_cards ?? 0,
                          injuries: match.away_injuries ?? 0,
                          eventDetails: match.match_event_details?.away ?? null,
                        };
                    const penaltyShootout =
                      match.penalty_shootout_home_goals !== null && match.penalty_shootout_away_goals !== null
                        ? {
                            home: match.penalty_shootout_home_goals ?? 0,
                            away: match.penalty_shootout_away_goals ?? 0,
                          }
                        : null;
                    // Membership can change after a fixture; its saved participants cannot.
                    const homeIsBye = !match.home_team;
                    const awayIsBye = !match.away_team;
                    const homeFinalRating = match.match_120m_ratings?.find((rating) => rating.side === 'home');
                    const awayFinalRating = match.match_120m_ratings?.find((rating) => rating.side === 'away');
                    const availableChallenge = challengeAvailability[match.id];
                    const fixtureChallengeAction =
                      !isHistorical &&
                      status === 'not_arranged' &&
                      availableChallenge?.available &&
                      !availableChallenge.sent
                        ? {
                            direction: availableChallenge.side === 'away' ? ('left' as const) : ('right' as const),
                            onClick: () => openChallengeConfirmation(match.id),
                          }
                        : undefined;
                    const ratingsEligible =
                      !isHistorical &&
                      status === 'arranged' &&
                      !match.completed &&
                      Boolean(match.ht_match_id && match.chpp_match_date) &&
                      !homeIsBye &&
                      !awayIsBye &&
                      new Date(match.chpp_match_date || '').getTime() > Math.max(nowMs, ratingsBoundaryNow);
                    const privateFixture = privateRatings[match.id];
                    const homeRatings = privateFixture?.ratings.find(
                      (row) =>
                        row.team_id === match.home_team_id && Number(row.ht_match_id) === Number(match.ht_match_id),
                    );
                    const awayRatings = privateFixture?.ratings.find(
                      (row) =>
                        row.team_id === match.away_team_id && Number(row.ht_match_id) === Number(match.ht_match_id),
                    );
                    const homeShared = Boolean(
                      match.rating_share_statuses?.some((row) => row.team_id === match.home_team_id && row.shared !== false),
                    );
                    const awayShared = Boolean(
                      match.rating_share_statuses?.some((row) => row.team_id === match.away_team_id && row.shared !== false),
                    );
                    const ownHome =
                      ratingsEligible &&
                      ratingsAuth === 'ready' &&
                      Boolean(privateFixture?.ownedSides.includes('home'));
                    const ownAway =
                      ratingsEligible &&
                      ratingsAuth === 'ready' &&
                      Boolean(privateFixture?.ownedSides.includes('away'));
                    const canManageHome = ownHome && (!homeShared || Boolean(homeRatings));
                    const canManageAway = ownAway && (!awayShared || Boolean(awayRatings));
                    const showRatings = Boolean(
                      ratingsEligible && (homeRatings || awayRatings || canManageHome || canManageAway),
                    );
                    return (
                      <FixtureCard
                        key={match.id}
                        matchId={match.id}
                        isOwned={isOwnedMatch(match)}
                        ratingsPreview={
                          showRatings
                            ? { home: ratingsDisplay(homeRatings), away: ratingsDisplay(awayRatings) }
                            : undefined
                        }
                        ratingsSharedStatus={
                          ratingsEligible && (!homeRatings || !awayRatings)
                            ? {
                                home: homeRatings ? null : fixtureRatingNotice(match.rating_share_statuses?.find((row) => row.team_id === match.home_team_id), nowMs),
                                away: awayRatings ? null : fixtureRatingNotice(match.rating_share_statuses?.find((row) => row.team_id === match.away_team_id), nowMs),
                              }
                            : undefined
                        }
                        ratingsActions={
                          showRatings
                            ? {
                                home: canManageHome,
                                away: canManageAway,
                                onAction: (side, action) => updateRatings(match.id, side, action),
                              }
                            : undefined
                        }
                        date={status === 'misarranged' ? '' : isPostponed ? 'POSTPONED' : formattedDate}
                        dateIsEstimated={!hasConfirmedKickoff && !match.completed && !isHistorical}
                        status={status}
                        liveClock={status === 'ongoing' ? (liveMatch ?? undefined) : undefined}
                        liveKickoff={status === 'ongoing' && hasConfirmedKickoff ? match.match_date : undefined}
                        htMatchId={match.ht_match_id || undefined}
                        score={currentScore}
                        penaltyShootout={penaltyShootout}
                        matchType={match.match_type || undefined}
                        is120minMode={tournament?.scoring_mode === '120min' || tournament?.scoring_mode === 'average120'}
                        went_120={match.went_120}
                        completed={match.completed}
                        totalMinutes={match.total_minutes}
                        appgOutcome={match.appg_outcome}
                        challengeAction={fixtureChallengeAction}
                        homeTeam={{
                          name: homeIsBye ? 'BYE' : match.home_team?.name || 'BYE',
                          managerName: homeIsBye ? '' : match.home_team?.manager_name || 'UNKNOWN',
                          managerHtId: homeIsBye ? undefined : match.home_team?.hattrick_user_id,
                          htTeamId: homeIsBye ? 0 : match.home_team?.ht_team_id || 0,
                          logoUrl: homeIsBye ? undefined : match.home_team?.logo_url,
                          matchKitUrl: homeIsBye ? null : (liveMatch?.home_match_kit_url ?? match.home_match_kit_url),
                          warning: homeIsBye || !isMisarranged ? undefined : homeWarning?.type,
                          countryName: homeIsBye ? undefined : match.home_team?.country_name,
                          countryId: homeIsBye ? undefined : match.home_team?.country_id,
                          matchSummary: homeSummary,
                          ratingGrade: !isHistorical && match.completed && usesMatch120mRatings(tournament?.scoring_mode)
                            ? homeFinalRating?.grade : undefined,
                          ratingScore: !isHistorical && match.completed && usesMatch120mRatings(tournament?.scoring_mode)
                            ? homeFinalRating?.score : undefined,
                          reserveReplacingName: homeIsBye ? undefined : match.home_team?.reserve_replacing_name,
                          isBye: homeIsBye,
                        }}
                        awayTeam={{
                          name: awayIsBye ? 'BYE' : match.away_team?.name || 'BYE',
                          managerName: awayIsBye ? '' : match.away_team?.manager_name || 'UNKNOWN',
                          managerHtId: awayIsBye ? undefined : match.away_team?.hattrick_user_id,
                          htTeamId: awayIsBye ? 0 : match.away_team?.ht_team_id || 0,
                          logoUrl: awayIsBye ? undefined : match.away_team?.logo_url,
                          matchKitUrl: awayIsBye ? null : (liveMatch?.away_match_kit_url ?? match.away_match_kit_url),
                          warning: awayIsBye || !isMisarranged ? undefined : awayWarning?.type,
                          countryName: awayIsBye ? undefined : match.away_team?.country_name,
                          countryId: awayIsBye ? undefined : match.away_team?.country_id,
                          matchSummary: awaySummary,
                          ratingGrade: !isHistorical && match.completed && usesMatch120mRatings(tournament?.scoring_mode)
                            ? awayFinalRating?.grade : undefined,
                          ratingScore: !isHistorical && match.completed && usesMatch120mRatings(tournament?.scoring_mode)
                            ? awayFinalRating?.score : undefined,
                          reserveReplacingName: awayIsBye ? undefined : match.away_team?.reserve_replacing_name,
                          isBye: awayIsBye,
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>
        );
      })}
      {visibleRoundsCount < filteredRounds.length && (
        <div className={styles.formActionRow}>
          <Button
            variant="showMore"
            onClick={() =>
              setManualVisibleRoundsCount((prev) => {
                const base = prev ?? defaultVisibleRoundsCount;
                return Math.min(filteredRounds.length, base + 4);
              })
            }
          >
            {uiText('showMore')}
          </Button>
        </div>
      )}
      {fixtureChallengePreviewMode && (
        <SectionCard title={uiText('fixtureChallengePreview')}>
          <p className={styles.fixtureChallengePreviewNote}>{uiText('localPreviewOnlyItDoesNotReadTournamentData')}</p>
          <FixtureCard
            date="WED / 30.09. / 05:15"
            status="not_arranged"
            is120minMode
            challengeAction={{
              direction: 'right',
              onClick: () => openChallengeConfirmation(FIXTURE_CHALLENGE_PREVIEW_MATCH_ID),
            }}
            homeTeam={{
              name: 'Preview Home United',
              htTeamId: 900001,
              countryName: 'Latvia',
              countryId: 54,
              managerName: 'Preview manager',
              matchKitUrl: '/matchKitLarge.png',
              ratingGrade: 'A+',
            }}
            awayTeam={{
              name: 'Preview Opponent FC',
              htTeamId: 900002,
              countryName: 'Guam',
              countryId: 117,
              managerName: 'Preview opponent',
              matchKitUrl: '/matchKitLarge.png',
              ratingGrade: 'F-',
            }}
          />
        </SectionCard>
      )}
      {!isHistorical && tournament?.status !== 'finished' && canUpdateFixtures && rounds.length > 0 && (
        <div className={styles.fixturesUpdateAction}>
          <Button variant="action" size="sm" onClick={refreshFixturesAndRatings} disabled={isRefreshingFixtures}>
            <ArrowClockwise size={18} className={isRefreshingFixtures ? styles.spinning : undefined} />
            {isRefreshingFixtures ? uiText('updatingFixtures') : uiText('updateFixtures')}
          </Button>
        </div>
      )}
      <Modal
        isOpen={Boolean(selectedChallenge)}
        onClose={closeChallengeConfirmation}
        title={challengeSuccess ? '✅ Challenge sent' : '⚽️ Send a challenge'}
        maxWidth="520px"
      >
        <div className={styles.fixtureChallengeModal}>
          {challengeSuccess ? (
            <>
              <p>{challengeSuccess}</p>
              <Button
                variant="outlineWhite"
                fullWidth
                onClick={() => window.open(HATTRICK_CHALLENGES_URL, '_blank', 'noopener,noreferrer')}
              >
                {uiText('viewOnHattrick')} <span style={{ fontFamily: 'var(--sans)' }}>*</span>
              </Button>
              <p className={styles.fixtureChallengeHattrickHint}>{uiText('mightNeedSwitchingToTheCorrectTeam')}</p>
            </>
          ) : (
            <>
              <p>
                {uiText('sendAChallengeTo')} <strong>{selectedChallenge?.opponent?.name || uiText('thisTeam')}</strong>:
              </p>
              <div className={styles.fixtureChallengeOptions}>
                <div>
                  <h3>{uiText('type')}</h3>
                  <div
                    className={styles.fixtureChallengeRadioGroup}
                    role="radiogroup"
                    aria-label={uiText('challengeType')}
                  >
                    <label
                      className={`${styles.fixtureChallengeRadio} ${
                        selectedChallengeSelection.matchType === 'cup_rules' ? styles.selected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="fixture-challenge-type"
                        checked={selectedChallengeSelection.matchType === 'cup_rules'}
                        onChange={() =>
                          setChallengeSelection((current) => ({
                            ...(current || selectedChallengeSelection),
                            matchType: 'cup_rules',
                          }))
                        }
                      />
                      <span className={styles.fixtureChallengeRadioMark} aria-hidden="true" />{' '}
                      {uiText('cupRules120Min')}
                    </label>
                    <label
                      className={`${styles.fixtureChallengeRadio} ${
                        selectedChallengeSelection.matchType === 'normal' ? styles.selected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="fixture-challenge-type"
                        checked={selectedChallengeSelection.matchType === 'normal'}
                        onChange={() =>
                          setChallengeSelection((current) => ({
                            ...(current || selectedChallengeSelection),
                            matchType: 'normal',
                          }))
                        }
                      />
                      <span className={styles.fixtureChallengeRadioMark} aria-hidden="true" /> {uiText('normalRules')}
                    </label>
                  </div>
                </div>
                <div>
                  <h3>{uiText('venue')}</h3>
                  <div
                    className={styles.fixtureChallengeRadioGroup}
                    role="radiogroup"
                    aria-label={uiText('scheduledVenue')}
                  >
                    <label
                      className={`${styles.fixtureChallengeRadio} ${
                        selectedChallengeSelection.venue === 'home' ? styles.selected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="fixture-challenge-venue"
                        checked={selectedChallengeSelection.venue === 'home'}
                        onChange={() =>
                          setChallengeSelection((current) => ({
                            ...(current || selectedChallengeSelection),
                            venue: 'home',
                          }))
                        }
                      />
                      <span className={styles.fixtureChallengeRadioMark} aria-hidden="true" /> {uiText('home')}
                    </label>
                    <label
                      className={`${styles.fixtureChallengeRadio} ${
                        selectedChallengeSelection.venue === 'away' ? styles.selected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="fixture-challenge-venue"
                        checked={selectedChallengeSelection.venue === 'away'}
                        onChange={() =>
                          setChallengeSelection((current) => ({
                            ...(current || selectedChallengeSelection),
                            venue: 'away',
                          }))
                        }
                      />
                      <span className={styles.fixtureChallengeRadioMark} aria-hidden="true" />{' '}
                      {uiText('awayPerSchedule')}
                    </label>
                  </div>
                </div>
              </div>
              {challengeError && (
                <div className={styles.fixtureChallengeErrorBlock}>
                  <h3>{uiText('responseFromHattrick')}</h3>
                  <p className={styles.fixtureChallengeError}>{challengeError}</p>
                </div>
              )}
              <div className={styles.fixtureChallengeActions}>
                <Button variant="outlineWhite" fullWidth onClick={submitChallenge} disabled={isSendingChallenge}>
                  {isSendingChallenge ? uiText('challenging') : uiText('challenge')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};
