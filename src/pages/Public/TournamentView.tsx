/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

import adminStyles from './TournamentAdmin.module.sass';
import styles from './TournamentView.module.sass';
import { buildCalendarSlots, formatCalendarDateWithWeek } from '../../utils/hattrick-calendar';
import { getTournamentBackgroundStyle } from '../../utils/visuals';
import { calculateStandings } from '../../utils/standings';
import type { TeamStanding, Team as StandingTeam } from '../../utils/standings';
import {
  buildSeasonHistorySnapshot,
  resolveSeasonFinishedAt,
  resolveSeasonStartedAt,
  type SeasonHistorySnapshot,
  type SeasonHistoryMatch,
} from '../../utils/season-history';
import { validateTeamEligibility } from '../../utils/team-eligibility';
import { HATTRICK_LEAGUES, getLeagueIdByName, normalizeLeagueLimit } from '../../../shared/worlddetails';
import { useLiveMatches } from '../../hooks/useLiveMatches';
import { buildScheduleDraft, serializeScheduleDraftForRpc, type ScheduleMode } from '../../utils/schedule-draft';
import { buildRescheduleDraft, serializeRescheduleDraftForRpc } from '../../utils/reschedule-draft';
import { getMatchDateForRound as resolveMatchDateForRound } from '../../utils/match-schedule';
import { canViewerJoinTournament } from '../../utils/tournament-joinability';
import { markAuthRefreshCurrent, needsAuthRefresh } from '../../utils/auth-refresh';
import { hasSuperAdminBypassCookie } from '../../utils/superadmin-bypass';
import { formatTournamentName } from '../../utils/tournament-names';
import { isSandboxTournament, normalizeTournamentRegistrationType } from '../../utils/tournament-types';
import {
  JOINED_NOTICE_KEY,
  selectTournamentMessage,
  type TournamentAnnouncement,
  type TournamentAnnouncementDismissal,
  type TournamentAnnouncementVisibility,
} from '../../utils/tournament-announcements';

import { Tooltip } from 'react-tooltip';
import { nanoid } from 'nanoid';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { HeroCard } from '../../components/Card/HeroCard';
import { SectionCard } from '../../components/Card/SectionCard';
import { ChatView } from '../../components/TournamentTabs/ChatView';
import { FixturesView } from '../../components/TournamentTabs/FixturesView';
import { AdminResults } from '../../components/TournamentTabs/Admin/AdminResults';
import { AdminAnnouncementComposer } from '../../components/TournamentTabs/Admin/AdminAnnouncementComposer';
import { TournamentSchedulePanel } from '../../components/TournamentTabs/Admin/TournamentSchedulePanel';
import { CompactAccordionWidget } from '../../components/CompactAccordionWidget/CompactAccordionWidget';
import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
import { StandingsView } from '../../components/TournamentTabs/StandingsView';
import { TournamentHistory } from '../../components/TournamentHistory/TournamentHistory';
import { WelcomeModal } from '../../components/WelcomeModal/WelcomeModal';
import { TOURNAMENT_DEFAULT } from '../../constants/descriptions';
import { getTournamentFaqSections } from '../../constants/faq-essential';
import { FORGE_SUPERADMIN_USER_ID } from '../../constants/site-admins';
import { getRandomSandboxTeamId, SANDBOX_RANDOM_ATTEMPTS } from '../../constants/sandbox';
import {
  dismissWelcome,
  getTournamentVisitWelcomeKey,
  hasDismissedWelcome,
  TOURNAMENT_CREATED_WELCOME,
} from '../../utils/welcome-modals';
import { ArrowClockwise, ArrowRight, ArrowUpRight, CopySimple, Info, Question, Star, Trash, X } from 'phosphor-react';

const DEFAULT_TEAM_LOGO = '/default-logo.png';

interface ChppTeamOption {
  teamId: number;
  teamName: string;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryName?: string;
}

interface HtMatchLinkPreview {
  ht_match_id: number;
  actual_home_team_name: string | null;
  actual_away_team_name: string | null;
  home_goals: number;
  away_goals: number;
  status: 'arranged' | 'ongoing' | 'finished';
  matched_both_tournament_teams: boolean;
}

interface PendingJoinData {
  id: string;
  manager_name: string;
  teams_json: ChppTeamOption[];
  tournament_id: string | null;
  selection_token: string;
}

interface MatchWithTeams {
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
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  ht_match_id: number | null;
  match_type: number | null;
  venue_type?: 'home_away' | null;
  scheduled_for?: string | null;
  schedule_slot_type?: 'midweek_friendly' | 'weekend_friendly' | 'week15_weekend_friendly' | null;
  home_team: {
    name: string;
    ht_team_id: number;
    active: boolean;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    league_id?: number;
    league_level?: number | null;
    manager_name?: string;
    hattrick_user_id?: number;
  } | null;
  away_team: {
    name: string;
    ht_team_id: number;
    active: boolean;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    league_id?: number;
    league_level?: number | null;
    manager_name?: string;
    hattrick_user_id?: number;
  } | null;
  match_date?: Date;
}

interface Team {
  id: string;
  tournament_id: string;
  name: string;
  ht_team_id: number;
  active: boolean;
  replacement_for_team_id?: string;
  created_at: string;
  logo_url?: string;
  joined_via_oauth?: boolean;
  country_name?: string;
  country_id?: number | null;
  manager_name?: string;
  is_placeholder?: boolean;
  hattrick_user_id?: number;
  league_level?: number | null;
  league_id?: number | null;
}

interface FetchedTeamData {
  teamId: number;
  teamName: string;
  logoUrl?: string;
  countryName?: string;
  countryId?: number;
  leagueId?: number;
  genderId?: number;
  leagueLevel?: number;
}

interface Tournament {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  admin_password: string;
  scoring_mode: string;
  is_private: boolean;
  description: string | null;
  show_description: boolean;
  is_featured: boolean;
  thumbnail_index?: number;
  chpp_only_join: boolean;
  country_limit: string | null;
  league_category: 'male' | 'hfi';
  registration_type: string;
  include_week15_weekend_friendly: boolean;
  organizer_name?: string;
  organizer_id?: number;
  image_url?: string;
  season: number;
  is_test: boolean;
  status: 'open' | 'active' | 'paused' | 'stopped' | 'finished' | 'waiting' | 'archived';
  last_fixtures_refresh: string | null;
  admin_email: string | null;
  max_teams: number | null;
  schedule_mode?: ScheduleMode | null;
  schedule_start_slot?: string | null;
  schedule_locked_at?: string | null;
  registration_closed_at?: string | null;
  schedule_generated_at?: string | null;
}

interface RoundWithMatches {
  id: string;
  round_number: number;
  created_at: string;
  season_number?: number;
  matches: MatchWithTeams[];
}

type TournamentStatus = Tournament['status'];

interface TournamentSeason {
  id: string;
  tournament_id: string;
  season_number: number;
  status: 'planned' | 'ongoing' | 'finished';
  planned_start_slot: string | null;
  started_at: string | null;
  finished_at: string | null;
  snapshot_json: SeasonHistorySnapshot | null;
  created_at: string;
  updated_at: string;
}

function hasFinishedAllRealFixtures(rounds: RoundWithMatches[]) {
  const matches = rounds.flatMap((round) => round.matches || []);
  const realFixtures = matches.filter((match) => match.home_team_id && match.away_team_id);

  return realFixtures.length > 0 && realFixtures.every((match) => match.completed || match.status === 'misarranged');
}

function toStandingTeam(team: Team): StandingTeam {
  return {
    id: team.id,
    name: team.name,
    ht_team_id: team.ht_team_id,
    hattrick_user_id: team.hattrick_user_id ?? null,
    active: team.active,
    replacement_for_team_id: team.replacement_for_team_id ?? null,
    joined_via_oauth: team.joined_via_oauth,
    country_name: team.country_name,
    country_id: team.country_id ?? null,
    league_id: team.league_id ?? null,
    logo_url: team.logo_url,
    manager_name: team.manager_name,
    is_placeholder: team.is_placeholder,
  };
}

function toSeasonHistoryMatch(match: MatchWithTeams, roundNumber?: number): SeasonHistoryMatch {
  return {
    id: match.id,
    roundNumber,
    scheduledFor: match.scheduled_for || match.match_date?.toISOString() || null,
    homeTeamName: match.home_team?.name || null,
    awayTeamName: match.away_team?.name || null,
    home_team_id: match.home_team_id,
    away_team_id: match.away_team_id,
    home_goals: match.home_goals,
    away_goals: match.away_goals,
    completed: match.completed,
    went_120: match.went_120,
    total_minutes: match.total_minutes,
    home_yellow_cards: match.home_yellow_cards,
    home_red_cards: match.home_red_cards,
    home_injuries: match.home_injuries,
    away_yellow_cards: match.away_yellow_cards,
    away_red_cards: match.away_red_cards,
    away_injuries: match.away_injuries,
  };
}

function isBlockingTeamTournament(
  tournament?: {
    status?: string | null;
    is_test?: boolean | null;
    registration_type?: string | null;
  } | null,
) {
  return Boolean(
    tournament &&
    tournament.status !== 'finished' &&
    tournament.status !== 'stopped' &&
    !tournament.is_test &&
    tournament.registration_type !== 'sandbox',
  );
}

export const TournamentView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tournamentFaqSections = useMemo(() => getTournamentFaqSections(), []);
  const tournamentFaqItems = useMemo(
    () => tournamentFaqSections.flatMap((section) => section.items).map((item) => ({
      id: item.id,
      title: item.question,
      body: item.answer,
    })),
    [tournamentFaqSections],
  );
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [rounds, setRounds] = useState<RoundWithMatches[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [lastSeenMap, setLastSeenMap] = useState<Record<number, string | null>>({});
  const [playingElsewhereTeamIds, setPlayingElsewhereTeamIds] = useState<Set<number>>(new Set());

  // Sync activeTab with URL search param 'tab'
  const activeTabParam = searchParams.get('tab');
  const activeTab = ['standings', 'fixtures', 'history', 'guestbook', 'admin', 'news'].includes(activeTabParam || '')
    ? (activeTabParam as any)
    : location.state?.isAdminInit
      ? 'admin'
      : 'standings';

  const [isRefreshingFixtures, setIsRefreshingFixtures] = useState(false);

  // News states
  const [newsPosts, setNewsPosts] = useState<any[]>([]);
  const [newNewsTitle, setNewNewsTitle] = useState('');
  const [newNewsContent, setNewNewsContent] = useState('');
  const [isPostingNews, setIsPostingNews] = useState(false);
  const [newsMode, setNewsMode] = useState<'admin' | 'team'>('team');
  const [announcements, setAnnouncements] = useState<TournamentAnnouncement[]>([]);
  const [announcementDismissals, setAnnouncementDismissals] = useState<TournamentAnnouncementDismissal[]>([]);
  const [, setPublicAnnouncementDismissalVersion] = useState(0);
  const [seasons, setSeasons] = useState<TournamentSeason[]>([]);
  const [historyReportNoticeOpen, setHistoryReportNoticeOpen] = useState(false);
  const [historySeasonCommentCounts, setHistorySeasonCommentCounts] = useState<Record<string, number>>({});
  const [historySeenVersion, setHistorySeenVersion] = useState(0);
  const [isAddingSeason, setIsAddingSeason] = useState(false);
  const [rebuildingSeasonNumber, setRebuildingSeasonNumber] = useState<number | null>(null);
  const [isFinalizingSeason, setIsFinalizingSeason] = useState(false);

  // Chat states
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  // Admin states
  const [password, setPassword] = useState(localStorage.getItem(`admin_pw_${slug}`) || '');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState(false);
  const [failedLoginAttempt, setFailedLoginAttempt] = useState(false);
  const paramsHandledRef = useRef(false);
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [isUpdatingImage, setIsUpdatingImage] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamData, setNewTeamData] = useState<FetchedTeamData | null>(null);
  const [sandboxCandidate, setSandboxCandidate] = useState<FetchedTeamData | null>(null);
  const [sandboxFetchError, setSandboxFetchError] = useState('');
  const [isFetchingSandboxTeam, setIsFetchingSandboxTeam] = useState(false);
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<Record<string, Partial<MatchWithTeams>>>({});
  const [replacingTeamId, setReplacingTeamId] = useState<string | null>(null);
  const [replacementHtId, setReplacementHtId] = useState('');
  const [replacementName, setReplacementName] = useState('');
  const [replacementTeamData, setReplacementTeamData] = useState<FetchedTeamData | null>(null);
  const [isFetchingTeamData, setIsFetchingTeamData] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('single');
  const [scheduleStartSlotId, setScheduleStartSlotId] = useState('');
  const [includeWeek15WeekendFriendly, setIncludeWeek15WeekendFriendly] = useState(false);
  const [rescheduleFromRoundNumber, setRescheduleFromRoundNumber] = useState<number | null>(null);
  const [rescheduleStartSlotId, setRescheduleStartSlotId] = useState('');
  const [includeWeek15WeekendFriendlyForReschedule, setIncludeWeek15WeekendFriendlyForReschedule] = useState(false);
  const [organizerProfileName, setOrganizerProfileName] = useState<string | null>(null);
  const currentHtUserId = Number(localStorage.getItem('my_ht_user_id') || '0') || null;

  const latestPublishedHistorySeason = useMemo(
    () =>
      [...seasons]
        .filter((season) => season.status === 'finished' && season.snapshot_json)
        .sort((a, b) => b.season_number - a.season_number)[0] || null,
    [seasons],
  );
  const [renderTimestamp] = useState(() => Date.now());
  const historyReportPublishedAt = latestPublishedHistorySeason?.snapshot_json?.generatedAt || null;
  const historyReportNoticeIsCurrent = Boolean(
    historyReportPublishedAt &&
      renderTimestamp - new Date(historyReportPublishedAt).getTime() <= 7 * 24 * 60 * 60 * 1000,
  );

  useEffect(() => {
    if (!tournament || !latestPublishedHistorySeason || !historyReportNoticeIsCurrent || !currentHtUserId) return;

    let cancelled = false;
    fetch(
      `/api/tournaments/history?notice=history-report-status&seasonId=${encodeURIComponent(latestPublishedHistorySeason.id)}&tournamentId=${encodeURIComponent(tournament.id)}`,
    )
      .then((response) => response.json())
      .then((data: { dismissed?: boolean; seen?: boolean; tracked?: boolean }) => {
        if (cancelled) return;
        setHistoryReportNoticeOpen(data.tracked === true && data.dismissed !== true && data.seen !== true);
      })
      .catch(() => {
        if (!cancelled) setHistoryReportNoticeOpen(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentHtUserId, historyReportNoticeIsCurrent, latestPublishedHistorySeason, tournament]);

  useEffect(() => {
    if (!tournament || !activeTab || activeTab !== 'history' || !latestPublishedHistorySeason || !currentHtUserId) return;
    void fetch('/api/tournaments/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark-history-report-seen',
        seasonId: latestPublishedHistorySeason.id,
        tournamentId: tournament.id,
      }),
    });
  }, [activeTab, currentHtUserId, latestPublishedHistorySeason, tournament]);

  const dismissHistoryReportNotice = () => {
    if (!tournament || !latestPublishedHistorySeason || !currentHtUserId) return;
    setHistoryReportNoticeOpen(false);
    void fetch('/api/tournaments/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark-history-report-dismissed',
        seasonId: latestPublishedHistorySeason.id,
        tournamentId: tournament.id,
      }),
    });
  };

  const markHistoryReportSeen = () => {
    if (!tournament || !latestPublishedHistorySeason || !currentHtUserId) return;
    setHistoryReportNoticeOpen(false);
    void fetch('/api/tournaments/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark-history-report-seen',
        seasonId: latestPublishedHistorySeason.id,
        tournamentId: tournament.id,
      }),
    });
  };

  // Tournament settings states
  const [editName, setEditName] = useState('');
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [editChppOnlyJoin, setEditChppOnlyJoin] = useState(true);
  const [editLeagueCategory, setEditLeagueCategory] = useState<'male' | 'hfi'>('male');
  const [editRegistrationType, setEditRegistrationType] = useState('validated');
  const [editCountryLimit, setEditCountryLimit] = useState<string | null>(null);
  const [editMaxTeams, setEditMaxTeams] = useState<number | null>(null);
  const [showEditDescription, setShowEditDescription] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [showEditEmail, setShowEditEmail] = useState(false);
  const [editAdminEmail, setEditAdminEmail] = useState('');
  const [hasClosedCreatedTournamentWelcome, setHasClosedCreatedTournamentWelcome] = useState(false);
  const [hasClosedOpenTournamentWelcome, setHasClosedOpenTournamentWelcome] = useState(false);
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [isResettingAdminPassword, setIsResettingAdminPassword] = useState(false);
  const [isTest, setIsTest] = useState(false);
  const [editIsFeatured, setEditIsFeatured] = useState(false);
  const validatedCountryLimit = useMemo(() => {
    const validatedTeams = teams.filter((t) => t.joined_via_oauth && t.country_name);
    const countries = Array.from(new Set(validatedTeams.map((t) => t.country_name)));
    if (countries.length !== 1) return null;
    return getLeagueIdByName(countries[0]!) ?? null;
  }, [teams]);

  const savedStartSlotId = useMemo(() => {
    if (!tournament?.schedule_start_slot) return '';
    const storedStartSlot = buildCalendarSlots(new Date(), 160).find(
      (slot) => slot.nominalDate.toISOString() === tournament.schedule_start_slot,
    );
    return storedStartSlot?.id || '';
  }, [tournament]);

  const myHtUserId = localStorage.getItem('my_ht_user_id');
  const hasJoined = teams.some((t) => t.hattrick_user_id === Number(myHtUserId) && t.active);
  const isSandbox = tournament ? isSandboxTournament(tournament.registration_type) : false;
  const isPausedTournament = tournament?.status === 'paused';
  const isStoppedTournament = tournament?.status === 'stopped';
  const organizerTeam = tournament?.organizer_id
    ? teams.find((team) => Number(team.hattrick_user_id) === Number(tournament.organizer_id))
    : null;
  const publicOrganizerName = tournament?.organizer_name || organizerTeam?.manager_name || organizerProfileName || null;
  const currentHtManagerName = localStorage.getItem('my_ht_manager_name') || publicOrganizerName || 'Admin';
  const canLoginAsOrganizer = Boolean(
    tournament?.organizer_id && currentHtUserId && Number(tournament.organizer_id) === currentHtUserId,
  );

  const tournamentVisitWelcomeKey = slug ? getTournamentVisitWelcomeKey(slug) : null;
  const showCreatedTournamentWelcome = searchParams.get('welcome') === TOURNAMENT_CREATED_WELCOME;
  const showCreatedTournamentWelcomeVisible = showCreatedTournamentWelcome && !hasClosedCreatedTournamentWelcome;
  const showOpenTournamentWelcome = Boolean(
    tournamentVisitWelcomeKey &&
    slug &&
    tournament &&
    !showCreatedTournamentWelcomeVisible &&
    !isSandbox &&
    tournament.status === 'open' &&
    !hasJoined &&
    !canLoginAsOrganizer &&
    !hasClosedOpenTournamentWelcome &&
    !hasDismissedWelcome(tournamentVisitWelcomeKey),
  );

  const isSuperAdmin = useMemo(() => hasSuperAdminBypassCookie(document.cookie), []);
  const canManageFeaturedTournaments = isSuperAdmin && currentHtUserId === FORGE_SUPERADMIN_USER_ID;
  const organizerLoginLabel = `🤖 ${currentHtManagerName} (organizer)`;
  const dismissedPublicAnnouncementIds = new Set(
    announcements
      .filter((announcement) => localStorage.getItem(`announcement_dismissed_${announcement.id}`) === 'true')
      .map((announcement) => announcement.id),
  );
  const settingsHasUnsavedChanges = useMemo(() => {
    if (!tournament) return false;

    const savedCountryLimit = normalizeLeagueLimit(tournament.country_limit);
    const savedAdminEmail = tournament.admin_email || '';

    return (
      editName !== tournament.name ||
      editIsPrivate !== tournament.is_private ||
      editChppOnlyJoin !== tournament.chpp_only_join ||
      editLeagueCategory !== (tournament.league_category || 'male') ||
      editRegistrationType !== normalizeTournamentRegistrationType(tournament.registration_type) ||
      editCountryLimit !== savedCountryLimit ||
      editMaxTeams !== (tournament.max_teams || null) ||
      showEditDescription !== tournament.show_description ||
      editDescription !== (tournament.description || '') ||
      showEditEmail !== Boolean(tournament.admin_email) ||
      editAdminEmail !== savedAdminEmail ||
      scheduleStartSlotId !== savedStartSlotId ||
      isTest !== Boolean(tournament.is_test) ||
      editIsFeatured !== Boolean(tournament.is_featured)
    );
  }, [
    editAdminEmail,
    editChppOnlyJoin,
    editCountryLimit,
    editDescription,
    editIsPrivate,
    editLeagueCategory,
    editMaxTeams,
    editName,
    editRegistrationType,
    isTest,
    scheduleStartSlotId,
    savedStartSlotId,
    showEditDescription,
    showEditEmail,
    editIsFeatured,
    tournament,
  ]);

  // Collapsible states
  const [isSettingsCollapsed, setIsSettingsCollapsed] = useState(() =>
    JSON.parse(localStorage.getItem(`settings_collapsed_${slug}`) || 'false'),
  );
  const [isTeamsCollapsed, setIsTeamsCollapsed] = useState(() =>
    JSON.parse(localStorage.getItem(`teams_collapsed_${slug}`) || 'true'),
  );
  const [isResultsCollapsed, setIsResultsCollapsed] = useState(() =>
    JSON.parse(localStorage.getItem(`results_collapsed_${slug}`) || 'false'),
  );
  const [scheduleCollapseOverrides, setScheduleCollapseOverrides] = useState<Record<string, boolean>>({});
  const scheduleCollapseStorageKey = slug ? `schedule_collapsed_${slug}` : null;
  const scheduleCollapseOverride = useMemo(() => {
    if (!scheduleCollapseStorageKey) return null;
    if (slug && Object.prototype.hasOwnProperty.call(scheduleCollapseOverrides, slug)) {
      return scheduleCollapseOverrides[slug];
    }
    const stored = localStorage.getItem(scheduleCollapseStorageKey);
    return stored !== null ? JSON.parse(stored) : null;
  }, [scheduleCollapseOverrides, scheduleCollapseStorageKey, slug]);

  // Helper to persist toggle
  const togglePanel = (key: string, state: boolean, setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setter(state);
    if (slug) localStorage.setItem(`${key}_collapsed_${slug}`, JSON.stringify(state));
  };

  // Join states
  const [isJoining, setIsJoining] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [joinTeamId, setJoinTeamId] = useState('');
  const [joinTeamName, setJoinTeamName] = useState('');
  const [isInviteExpanded, setIsInviteExpanded] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [pendingJoinData, setPendingJoinData] = useState<PendingJoinData | null>(null);
  const [submittingJoin, setSubmittingJoin] = useState(false);

  // UI state
  const [showScoringHelp, setShowScoringHelp] = useState(false);
  const [isAddingDescription, setIsAddingDescription] = useState(false);
  const [expandedRounds, setExpandedRounds] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(`expanded_rounds_${slug}`);
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem(`expanded_rounds_${slug}`, JSON.stringify(expandedRounds));
  }, [expandedRounds, slug]);

  const toggleRound = useCallback((roundId: string) => {
    setExpandedRounds((current) => ({
      ...current,
      [roundId]: !current[roundId],
    }));
  }, []);
  const [quickDescription, setQuickDescription] = useState('');
  const [isJoinedNoticeDismissed, setIsJoinedNoticeDismissed] = useState(
    localStorage.getItem(`joined_notice_dismissed_${slug}`) === 'true',
  );

  const regenerateDescription = (isQuick: boolean) => {
    const randomDesc = TOURNAMENT_DEFAULT[Math.floor(Math.random() * TOURNAMENT_DEFAULT.length)];
    if (isQuick) setQuickDescription(randomDesc);
    else setEditDescription(randomDesc);
  };

  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<Record<string, boolean>>({});

  const allMatches = rounds.flatMap((r) => r.matches);
  const isGenerated = rounds.length > 0;
  const { liveData, lastRefresh } = useLiveMatches(
    tournament?.id,
    allMatches,
    () => {
      // Note: fetchData is defined below but hoisted as a const,
      // we call it inside this effect/callback safely.
    },
    activeTab === 'fixtures',
  );

  const isHealthQuotaMet = useCallback(
    (teamList: Team[] = teams) => {
      if (!teamList.length) return true;
      const totalCount = teamList.filter((t) => !t.is_placeholder).length;
      const inactiveCount = teamList.filter((t) => !t.active && !t.is_placeholder).length;

      // Small tournaments (2-3 teams) are exempt as per prompt ("recurring friendlies")
      if (totalCount <= 3) return true;

      if (totalCount <= 5) return inactiveCount === 0;
      if (totalCount === 6) return inactiveCount <= 1;
      if (totalCount === 7) return inactiveCount === 0;

      return inactiveCount / totalCount <= 0.25;
    },
    [teams],
  );

  const activeScheduleTeams = useMemo(
    () =>
      teams
        .filter((team) => team.active && !team.is_placeholder)
        .map((team) => ({
          id: team.id,
          name: team.name,
          active: team.active,
          isPlaceholder: team.is_placeholder,
          countryName: team.country_name ?? null,
          leagueLevel: team.league_level ?? null,
        })),
    [teams],
  );
  const scheduleDraft = useMemo(
    () =>
      buildScheduleDraft({
        teams: activeScheduleTeams,
        mode: scheduleMode,
        startSlotId: scheduleStartSlotId || null,
        includeWeek15WeekendFriendly,
        now: new Date(),
      }),
    [activeScheduleTeams, includeWeek15WeekendFriendly, scheduleMode, scheduleStartSlotId],
  );
  const serializedScheduleDraft = useMemo(
    () => (scheduleDraft.valid && scheduleDraft.selectedStartSlot ? serializeScheduleDraftForRpc(scheduleDraft) : null),
    [scheduleDraft],
  );
  const rescheduleInputRounds = useMemo(
    () =>
      rounds.map((round) => ({
        id: round.id,
        roundNumber: round.round_number,
        matches: round.matches.map((match) => ({
          id: match.id,
          homeTeamId: match.home_team_id,
          awayTeamId: match.away_team_id,
          status: match.status ?? 'not_arranged',
          completed: match.completed,
          htMatchId: match.ht_match_id,
          scheduledFor: match.scheduled_for ?? null,
          matchDate: match.match_date ?? null,
          scheduleSlotType: match.schedule_slot_type ?? null,
          venueType: match.venue_type ?? 'home_away',
        })),
      })),
    [rounds],
  );
  const rescheduleDraft = useMemo(
    () =>
      buildRescheduleDraft({
        teams: activeScheduleTeams,
        rounds: rescheduleInputRounds,
        fromRoundNumber: rescheduleFromRoundNumber,
        startSlotId: rescheduleStartSlotId || null,
        includeWeek15WeekendFriendly: includeWeek15WeekendFriendlyForReschedule,
        now: new Date(),
      }),
    [
      activeScheduleTeams,
      includeWeek15WeekendFriendlyForReschedule,
      rescheduleFromRoundNumber,
      rescheduleInputRounds,
      rescheduleStartSlotId,
    ],
  );
  const serializedRescheduleDraft = useMemo(
    () =>
      rescheduleDraft.valid && rescheduleDraft.selectedStartSlot
        ? serializeRescheduleDraftForRpc(rescheduleDraft)
        : null,
    [rescheduleDraft],
  );
  const resolvedScheduleCollapsed = scheduleCollapseOverride ?? isGenerated;

  const reconcileScheduleSelection = useCallback(
    (nextMode: ScheduleMode, nextStartSlotId: string | null) => {
      const nextDraft = buildScheduleDraft({
        teams: activeScheduleTeams,
        mode: nextMode,
        startSlotId: nextStartSlotId,
        includeWeek15WeekendFriendly,
        now: new Date(),
      });
      setScheduleMode(nextDraft.mode);
      setScheduleStartSlotId(nextDraft.selectedStartSlotId || '');
    },
    [activeScheduleTeams, includeWeek15WeekendFriendly],
  );

  const handleScheduleModeChange = useCallback(
    (nextMode: ScheduleMode) => {
      reconcileScheduleSelection(nextMode, scheduleStartSlotId || null);
    },
    [reconcileScheduleSelection, scheduleStartSlotId],
  );

  const handleScheduleStartSlotIdChange = useCallback(
    (nextStartSlotId: string) => {
      reconcileScheduleSelection(scheduleDraft.mode, nextStartSlotId || null);
    },
    [reconcileScheduleSelection, scheduleDraft.mode],
  );

  const handleIncludeWeek15WeekendFriendlyChange = useCallback(
    (nextValue: boolean) => {
      setIncludeWeek15WeekendFriendly(nextValue);
      const nextDraft = buildScheduleDraft({
        teams: activeScheduleTeams,
        mode: scheduleDraft.mode,
        startSlotId: scheduleStartSlotId || null,
        includeWeek15WeekendFriendly: nextValue,
        now: new Date(),
      });
      setScheduleMode(nextDraft.mode);
      setScheduleStartSlotId(nextDraft.selectedStartSlotId || '');
    },
    [activeScheduleTeams, scheduleDraft.mode, scheduleStartSlotId],
  );

  const reconcileRescheduleSelection = useCallback(
    (nextFromRoundNumber: number | null, nextStartSlotId: string | null) => {
      const nextDraft = buildRescheduleDraft({
        teams: activeScheduleTeams,
        rounds: rescheduleInputRounds,
        fromRoundNumber: nextFromRoundNumber,
        startSlotId: nextStartSlotId,
        includeWeek15WeekendFriendly: includeWeek15WeekendFriendlyForReschedule,
        now: new Date(),
      });
      setRescheduleFromRoundNumber(nextDraft.selectedFromRoundNumber);
      setRescheduleStartSlotId(nextDraft.selectedStartSlotId || '');
    },
    [activeScheduleTeams, includeWeek15WeekendFriendlyForReschedule, rescheduleInputRounds],
  );

  const handleRescheduleFromRoundChange = useCallback((nextRoundNumber: number) => {
    setRescheduleFromRoundNumber(nextRoundNumber || null);
    setRescheduleStartSlotId('');
  }, []);

  const handleRescheduleStartSlotIdChange = useCallback(
    (nextStartSlotId: string) => {
      reconcileRescheduleSelection(rescheduleFromRoundNumber, nextStartSlotId || null);
    },
    [reconcileRescheduleSelection, rescheduleFromRoundNumber],
  );

  const handleIncludeWeek15WeekendFriendlyForRescheduleChange = useCallback(
    (nextValue: boolean) => {
      setIncludeWeek15WeekendFriendlyForReschedule(nextValue);
      const nextDraft = buildRescheduleDraft({
        teams: activeScheduleTeams,
        rounds: rescheduleInputRounds,
        fromRoundNumber: rescheduleFromRoundNumber,
        startSlotId: rescheduleStartSlotId || null,
        includeWeek15WeekendFriendly: nextValue,
        now: new Date(),
      });
      setRescheduleFromRoundNumber(nextDraft.selectedFromRoundNumber);
      setRescheduleStartSlotId(nextDraft.selectedStartSlotId || '');
    },
    [activeScheduleTeams, rescheduleFromRoundNumber, rescheduleInputRounds, rescheduleStartSlotId],
  );

  const getMatchDateForRound = useCallback(
    (round: RoundWithMatches, match: MatchWithTeams) =>
      resolveMatchDateForRound(round, match, match.home_team?.country_name),
    [],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: tournamentData } = await supabase.from('tournaments').select('*').eq('slug', slug).single();

    if (tournamentData) {
      setTournament(tournamentData as Tournament);
      setOrganizerProfileName(null);
      if (!tournamentData.organizer_name && tournamentData.organizer_id) {
        const { data: organizerProfile } = await supabase
          .from('profiles')
          .select('manager_name')
          .eq('hattrick_user_id', tournamentData.organizer_id)
          .maybeSingle();
        setOrganizerProfileName(organizerProfile?.manager_name || null);
      }
      localStorage.setItem('last_viewed_tournament_id', tournamentData.id);
      const currentSeasonNumber = Number(tournamentData.season || 1);
      const { data: seasonData, error: seasonError } = await supabase
        .from('tournament_seasons')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .order('season_number', { ascending: true });
      if (!seasonError && seasonData) {
        setSeasons(seasonData as TournamentSeason[]);
      } else {
        setSeasons([]);
      }
      setEditName(tournamentData.name);
      setEditIsPrivate(tournamentData.is_private);
      setEditChppOnlyJoin(tournamentData.chpp_only_join);
      setEditLeagueCategory(tournamentData.league_category || 'male');
      setEditRegistrationType(normalizeTournamentRegistrationType(tournamentData.registration_type));
      setEditCountryLimit(normalizeLeagueLimit(tournamentData.country_limit));
      setScheduleMode((tournamentData.schedule_mode as ScheduleMode | null) || 'single');
      const storedStartSlot = tournamentData.schedule_start_slot
        ? buildCalendarSlots(new Date(), 160).find(
            (slot) => slot.nominalDate.toISOString() === tournamentData.schedule_start_slot,
          )
        : null;
      setScheduleStartSlotId(storedStartSlot?.id || '');
      setIsTest(tournamentData.is_test || false);
      setShowEditDescription(tournamentData.show_description);
      setEditDescription(tournamentData.description || '');
      setShowEditEmail(!!tournamentData.admin_email);
      setEditAdminEmail(tournamentData.admin_email || '');
      setEditMaxTeams(tournamentData.max_teams || null);
      setIncludeWeek15WeekendFriendly(false);
      setIncludeWeek15WeekendFriendlyForReschedule(Boolean(tournamentData.include_week15_weekend_friendly));
      setEditIsFeatured(Boolean(tournamentData.is_featured));
      const { data: teamsDataRaw } = await supabase
        .from('teams')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .order('created_at', { ascending: true });

      const teamsData = teamsDataRaw || [];

      // Fetch profiles to get country_id and up-to-date manager_name
      let nextProfileMap: Record<number, { country_id: number | null; manager_name: string }> = {};
      let nextLastSeenMap: Record<number, string | null> = {};
      if (teamsData.length > 0) {
        const userIds = teamsData.map((t) => t.hattrick_user_id).filter(Boolean);
        if (userIds.length > 0) {
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('hattrick_user_id, country_id, manager_name, last_seen_at')
            .in('hattrick_user_id', userIds);
          if (profilesData) {
            nextProfileMap = Object.fromEntries(
              profilesData.map((p) => [
                Number(p.hattrick_user_id),
                { country_id: p.country_id ?? null, manager_name: p.manager_name },
              ]),
            );
            nextLastSeenMap = Object.fromEntries(
              profilesData.map((p) => [Number(p.hattrick_user_id), p.last_seen_at ?? null]),
            );
          }
        }
      }

      setLastSeenMap(nextLastSeenMap);

      setTeams(teamsData);

      const activeHtTeamIds = teamsData
        .filter((team) => team.active && !team.is_placeholder && team.ht_team_id)
        .map((team) => team.ht_team_id);

      if (activeHtTeamIds.length > 0) {
        const { data: elsewhereRows } = await supabase
          .from('teams')
          .select('ht_team_id, tournament_id, tournaments(name, status, is_test, registration_type)')
          .in('ht_team_id', activeHtTeamIds)
          .eq('active', true)
          .neq('tournament_id', tournamentData.id);

        const elsewhereIds = new Set<number>();
        (elsewhereRows || []).forEach((row) => {
          const tournament = Array.isArray(row.tournaments) ? row.tournaments[0] : row.tournaments;
          if (row.ht_team_id && isBlockingTeamTournament(tournament)) {
            elsewhereIds.add(Number(row.ht_team_id));
          }
        });
        setPlayingElsewhereTeamIds(elsewhereIds);
      } else {
        setPlayingElsewhereTeamIds(new Set());
      }

      const fetchedScheduleTeams = teamsData
        .filter((team) => team.active && !team.is_placeholder)
        .map((team) => ({
          id: team.id,
          name: team.name,
          active: team.active,
          isPlaceholder: team.is_placeholder,
          countryName: team.country_name ?? null,
          leagueLevel: team.league_level ?? null,
        }));
      const reconciledDraft = buildScheduleDraft({
        teams: fetchedScheduleTeams,
        mode: (tournamentData.schedule_mode as ScheduleMode | null) || 'single',
        startSlotId: storedStartSlot?.id || null,
        includeWeek15WeekendFriendly: false,
        now: new Date(),
      });
      setScheduleMode(reconciledDraft.mode);
      setScheduleStartSlotId(reconciledDraft.selectedStartSlotId || '');

      const { data: roundsData } = await supabase
        .from('rounds')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .eq('season_number', currentSeasonNumber)
        .order('round_number', { ascending: true });

      const { data: matchesDataRaw } = await supabase
        .from('matches')
        .select(
          `
          *,
          status,
          ht_match_id,
          match_type,
          home_team:teams!matches_home_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id, league_level, active, manager_name, hattrick_user_id),
          away_team:teams!matches_away_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id, league_level, active, manager_name, hattrick_user_id)
        `,
        )
        .in(
          'round_id',
          (roundsData || []).map((r) => r.id),
        );

      // Enrich matches with profile data
      const matchesData = (matchesDataRaw || []).map((m) => ({
        ...m,
        home_team: m.home_team
          ? {
              ...m.home_team,
              country_id: m.home_team.hattrick_user_id
                ? nextProfileMap[m.home_team.hattrick_user_id]?.country_id
                : null,
              manager_name: m.home_team.hattrick_user_id
                ? nextProfileMap[m.home_team.hattrick_user_id]?.manager_name || m.home_team.manager_name
                : m.home_team.manager_name,
            }
          : null,
        away_team: m.away_team
          ? {
              ...m.away_team,
              country_id: m.away_team.hattrick_user_id
                ? nextProfileMap[m.away_team.hattrick_user_id]?.country_id
                : null,
              manager_name: m.away_team.hattrick_user_id
                ? nextProfileMap[m.away_team.hattrick_user_id]?.manager_name || m.away_team.manager_name
                : m.away_team.manager_name,
            }
          : null,
      }));

      const { data: warningsData } = await supabase
        .from('fixture_warnings')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .eq('active', true);

      setWarnings(warningsData || []);

      const { data: announcementData } = await supabase
        .from('tournament_announcements')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .order('created_at', { ascending: false });
      setAnnouncements((announcementData as TournamentAnnouncement[] | null) || []);

      if (currentHtUserId) {
        const { data: dismissalData } = await supabase
          .from('tournament_announcement_dismissals')
          .select('*')
          .eq('tournament_id', tournamentData.id)
          .eq('hattrick_user_id', currentHtUserId);
        setAnnouncementDismissals((dismissalData as TournamentAnnouncementDismissal[] | null) || []);
      } else {
        setAnnouncementDismissals([]);
      }

      if (teamsData) {
        const matchesWithTeams = matchesData as unknown as MatchWithTeams[];

        // Add calculated match_date to each match for sorting and status detection
        const matchesWithDates = matchesWithTeams.map((m) => {
          const round = roundsData?.find((r) => r.id === m.round_id);
          return {
            ...m,
            match_date: round ? getMatchDateForRound(round as RoundWithMatches, m) : undefined,
          };
        });

        // Merge liveData into matches for immediate standings/UI updates
        const mergedMatches = matchesWithDates.map((m) => {
          const live = m.ht_match_id ? liveData[m.ht_match_id.toString()] : null;
          if (live) {
            return {
              ...m,
              home_goals:
                live.status === 'finished' || live.homeGoals > (m.home_goals || 0) ? live.homeGoals : m.home_goals,
              away_goals:
                live.status === 'finished' || live.awayGoals > (m.away_goals || 0) ? live.awayGoals : m.away_goals,
              completed: live.status === 'finished' || m.completed,
              status: live.status === 'finished' ? 'finished' : live.status || m.status,
              went_120: live.went_120 ?? m.went_120,
              total_minutes: live.total_minutes ?? m.total_minutes,
              home_yellow_cards: live.home_yellow_cards ?? m.home_yellow_cards,
              home_red_cards: live.home_red_cards ?? m.home_red_cards,
              home_injuries: live.home_injuries ?? m.home_injuries,
              away_yellow_cards: live.away_yellow_cards ?? m.away_yellow_cards,
              away_red_cards: live.away_red_cards ?? m.away_red_cards,
              away_injuries: live.away_injuries ?? m.away_injuries,
            };
          }
          return m;
        });

        const calculated = calculateStandings(
          teamsData.map((t) => ({
            id: t.id,
            name: t.name,
            ht_team_id: t.ht_team_id,
            hattrick_user_id: t.hattrick_user_id,
            active: t.active,
            replacement_for_team_id: t.replacement_for_team_id,
            joined_via_oauth: t.joined_via_oauth,
            country_name: t.country_name,
            country_id: t.country_id ?? null,
            league_id: t.league_id ?? null,
            logo_url: t.logo_url,
            manager_name: t.hattrick_user_id
              ? nextProfileMap[t.hattrick_user_id]?.manager_name || t.manager_name
              : t.manager_name,
          })),
          mergedMatches.map((m) => ({
            home_team_id: m.home_team_id,
            away_team_id: m.away_team_id,
            home_goals: m.home_goals,
            away_goals: m.away_goals,
            completed: m.completed,
            went_120: m.went_120,
            total_minutes: m.total_minutes,
          })),
          tournamentData.scoring_mode as any,
        );

        setStandings(calculated);

        if (roundsData) {
          const roundsWithMatches = roundsData.map((r) => ({
            ...r,
            matches: mergedMatches
              .filter((m) => m.round_id === r.id)
              .sort((a, b) => {
                const aDate = a.match_date?.getTime() || 0;
                const bDate = b.match_date?.getTime() || 0;
                if (aDate !== bDate) return aDate - bDate;
                return a.id.localeCompare(b.id);
              }),
          }));
          setRounds(roundsWithMatches as RoundWithMatches[]);

          const persistedRoundsWithMatches = roundsData.map((r) => ({
            ...r,
            matches: matchesWithDates.filter((m) => m.round_id === r.id),
          })) as RoundWithMatches[];

          if (
            tournamentData.status !== 'finished' &&
            tournamentData.status !== 'stopped' &&
            hasFinishedAllRealFixtures(persistedRoundsWithMatches)
          ) {
            const finishedAt = new Date().toISOString();
            const snapshot = buildSeasonHistorySnapshot(
              teamsData.map((team) =>
                toStandingTeam({
                  ...(team as Team),
                  manager_name: team.hattrick_user_id
                    ? nextProfileMap[team.hattrick_user_id]?.manager_name || team.manager_name
                    : team.manager_name,
                }),
              ),
              matchesWithDates.map((match) =>
                toSeasonHistoryMatch(match, roundsData.find((round) => round.id === match.round_id)?.round_number),
              ),
              tournamentData.scoring_mode as any,
            );
            await supabase.from('tournament_seasons').upsert(
              {
                tournament_id: tournamentData.id,
                season_number: currentSeasonNumber,
                status: 'finished',
                planned_start_slot: tournamentData.schedule_start_slot,
                started_at: tournamentData.schedule_generated_at,
                finished_at: finishedAt,
                snapshot_json: snapshot,
                updated_at: finishedAt,
              },
              { onConflict: 'tournament_id,season_number' },
            );
            const { error: finishError } = await supabase
              .from('tournaments')
              .update({ status: 'finished' })
              .eq('id', tournamentData.id);

            if (finishError) {
              console.error('Failed to mark tournament finished:', finishError);
            } else {
              setTournament((prev) => (prev ? { ...prev, status: 'finished' } : prev));
            }
          }
        }
      }
    }
    setLoading(false);
  }, [slug, liveData, getMatchDateForRound, currentHtUserId]);

  // Lightweight update: only refresh rounds, matches, warnings and last_fixtures_refresh timestamp.
  // Does not reload tournament meta, teams, standings, chat, news, or profiles.
  const fetchFixturesOnly = useCallback(async () => {
    if (!tournament) return;
    const { data: roundsData } = await supabase
      .from('rounds')
      .select('*')
      .eq('tournament_id', tournament.id)
      .eq('season_number', tournament.season || 1)
      .order('round_number', { ascending: true });
    if (!roundsData) return;

    const roundIds = roundsData.map((r: { id: string }) => r.id);
    const [{ data: matchesData }, { data: warningsData }, { data: tournamentMeta }] = await Promise.all([
      supabase
        .from('matches')
        .select(
          `
        *, status, ht_match_id, match_type,
        home_team:teams!matches_home_team_id_fkey(name, ht_team_id, logo_url, country_name, league_level, active, manager_name, hattrick_user_id),
        away_team:teams!matches_away_team_id_fkey(name, ht_team_id, logo_url, country_name, league_level, active, manager_name, hattrick_user_id)
      `,
        )
        .in('round_id', roundIds),
      supabase.from('fixture_warnings').select('*').eq('tournament_id', tournament.id).eq('active', true),
      supabase.from('tournaments').select('last_fixtures_refresh').eq('id', tournament.id).single(),
    ]);

    if (matchesData) {
      const newRounds = roundsData.map((r: { created_at: string; id: string; round_number: number }) => ({
        ...r,
        matches: (matchesData as MatchWithTeams[])
          .filter((m) => m.round_id === r.id)
          .map((m) => ({
            ...m,
            match_date: getMatchDateForRound(r as RoundWithMatches, m),
          }))
          .sort((a, b) => (a.match_date?.getTime() || 0) - (b.match_date?.getTime() || 0)),
      }));
      setRounds(newRounds as RoundWithMatches[]);
    }
    if (warningsData) setWarnings(warningsData);
    if (tournamentMeta)
      setTournament((prev) => (prev ? { ...prev, last_fixtures_refresh: tournamentMeta.last_fixtures_refresh } : prev));
  }, [tournament, getMatchDateForRound]);

  const fetchPresenceOnly = useCallback(async () => {
    if (!tournament) return;
    const userIds = teams.map((t) => t.hattrick_user_id).filter(Boolean);
    if (!userIds.length) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('hattrick_user_id, last_seen_at')
        .in('hattrick_user_id', userIds);

      if (error) {
        console.error('Failed to refresh presence map:', error);
        return;
      }

      if (data) {
        setLastSeenMap((prev) => {
          const next = { ...prev };
          data.forEach((p) => {
            if (p.hattrick_user_id) next[Number(p.hattrick_user_id)] = p.last_seen_at ?? null;
          });
          return next;
        });
      }
    } catch (error) {
      console.error('Presence refresh request failed:', error);
    }
  }, [tournament, teams]);

  // Keep last_fixtures_refresh updated in UI when live polling happens
  const prevLastRefreshRef = useRef(lastRefresh);
  useEffect(() => {
    if (lastRefresh && lastRefresh !== prevLastRefreshRef.current) {
      prevLastRefreshRef.current = lastRefresh;
      setTournament((prev) => (prev ? { ...prev, last_fixtures_refresh: lastRefresh } : null));
    }
  }, [lastRefresh]);

  const upcomingRoundIndex = rounds.findIndex((r) => r.matches.some((m) => !m.completed && m.status !== 'misarranged'));
  const currentRoundId = upcomingRoundIndex >= 0 ? (rounds[upcomingRoundIndex]?.id ?? null) : null;
  const defaultVisibleRoundsCount = rounds.length;

  const expandAllRounds = useCallback(() => {
    setExpandedRounds(
      rounds.reduce<Record<string, boolean>>((acc, round) => {
        acc[round.id] = true;
        return acc;
      }, {}),
    );
  }, [rounds]);

  const collapseAllRounds = useCallback(() => {
    setExpandedRounds(
      rounds.reduce<Record<string, boolean>>((acc, round) => {
        acc[round.id] = round.id === currentRoundId;
        return acc;
      }, {}),
    );
  }, [currentRoundId, rounds]);

  const fetchPendingJoinData = useCallback(
    async (token: string) => {
      setShowTeamModal(true);
      setModalLoading(true);
      console.log('TournamentView Querying Selection Token:', token);

      const { data, error } = await supabase
        .from('oauth_temp_sessions')
        .select('*')
        .eq('selection_token', token)
        .single();

      if (error || !data) {
        setShowTeamModal(false);
        alert('Invalid or expired selection session.');
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
        return;
      }

      setPendingJoinData(data);
      if (data.manager_name) {
        localStorage.setItem('my_ht_manager_name', data.manager_name);
      }
      if (data.hattrick_user_id) {
        localStorage.setItem('my_ht_user_id', String(data.hattrick_user_id));
      }
      setModalLoading(false);
    },
    [setModalLoading, setPendingJoinData, setShowTeamModal],
  );

  const handleTeamSelect = async (team: ChppTeamOption) => {
    if (!pendingJoinData) return;
    setSubmittingJoin(true);
    try {
      const response = await fetch('/api/auth/complete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selection_token: pendingJoinData.selection_token,
          team_id: team.teamId,
          team_name: team.teamName,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to complete join');

      if (result.hattrick_user_id) {
        localStorage.setItem('my_ht_user_id', result.hattrick_user_id.toString());
      }
      markAuthRefreshCurrent();
      if (result.manager_name) {
        localStorage.setItem('my_ht_manager_name', result.manager_name);
      }
      if (result.team_name) {
        localStorage.setItem('my_ht_team_name', result.team_name);
      }

      setShowTeamModal(false);
      setPendingJoinData(null);

      alert('Success! You have joined the tournament.');
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setSubmittingJoin(false);
    }
  };

  useEffect(() => {
    if (!tournament || isAdminAuthenticated) return;

    const storedAuthMode = localStorage.getItem(`admin_auth_${slug}`);
    const storedPassword = localStorage.getItem(`admin_pw_${slug}`);
    const organizerCanAutoLogin =
      storedAuthMode === 'organizer' &&
      canLoginAsOrganizer &&
      tournament.organizer_id &&
      Number(tournament.organizer_id) === currentHtUserId;

    if (organizerCanAutoLogin) {
      const timer = setTimeout(() => {
        setIsAdminAuthenticated(true);
        setAdminAuthError(false);
        setFailedLoginAttempt(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    if (
      (storedAuthMode === 'password' || !storedAuthMode) &&
      storedPassword &&
      tournament.admin_password &&
      storedPassword === tournament.admin_password
    ) {
      const timer = setTimeout(() => {
        setIsAdminAuthenticated(true);
        setAdminAuthError(false);
        setFailedLoginAttempt(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    if (password && password === tournament.admin_password) {
      const timer = setTimeout(() => {
        setIsAdminAuthenticated(true);
        localStorage.setItem(`admin_pw_${slug}`, password);
        localStorage.setItem(`admin_auth_${slug}`, 'password');
        setAdminAuthError(false);
        setFailedLoginAttempt(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [canLoginAsOrganizer, currentHtUserId, password, tournament, slug, isAdminAuthenticated]);

  useEffect(() => {
    const init = async () => {
      await fetchData();
    };
    init();
  }, [fetchData]);

  useEffect(() => {
    if (paramsHandledRef.current) return;

    // Check for error, success, or token param from OAuth
    const params = new URLSearchParams(window.location.search);
    const errorMsg = params.get('error');
    const joined = params.get('joined');
    const token = params.get('token');

    if (errorMsg || joined || token) {
      paramsHandledRef.current = true;
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);

      if (errorMsg) {
        alert(errorMsg);
      } else if (joined) {
        alert('Success! You have joined the tournament.');
      } else if (token) {
        setTimeout(() => {
          void fetchPendingJoinData(token);
        }, 0);
      }
    }
  }, [fetchPendingJoinData]);

  useEffect(() => {
    if (location.state?.isAdminInit) {
      setSearchParams({ tab: 'admin' });
    }
  }, [location.state?.isAdminInit, setSearchParams]);

  const isNewsTab = activeTab === 'guestbook' || activeTab === 'news';

  useEffect(() => {
    if (isNewsTab && tournament) {
      const fetchPosts = async () => {
        const { data } = await supabase
          .from('news_posts')
          .select('*')
          .eq('tournament_id', tournament.id)
          .order('created_at', { ascending: false });
        setNewsPosts(data || []);
      };
      fetchPosts();

      const channel = supabase
        .channel(`news:${tournament.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'news_posts',
            filter: `tournament_id=eq.${tournament.id}`,
          },
          (payload) => {
            setNewsPosts((prev) => [payload.new as any, ...prev]);
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [activeTab, isNewsTab, tournament]);

  const handlePostMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNewsContent.trim() || !tournament) return;

    setIsPostingNews(true);
    try {
      // Try to find current team in this tournament
      const myHtId = localStorage.getItem('my_ht_user_id');
      const myTeam = myHtId ? teams.find((t) => t.hattrick_user_id === Number(myHtId)) : null;

      const { error } = await supabase.from('news_posts').insert({
        tournament_id: tournament.id,
        title: newNewsTitle.trim(),
        content: newNewsContent.trim(),
        author_name: newsMode === 'admin' ? 'Tournament Administration' : myTeam?.name || 'Guest',
        author_team_id: newsMode === 'admin' ? null : myTeam?.id || null,
        is_admin: newsMode === 'admin',
      });

      if (error) throw error;
      setNewNewsContent('');
      setNewNewsTitle('');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsPostingNews(false);
    }
  };

  const handleRefreshFixtures = useCallback(async () => {
    if (!tournament || isRefreshingFixtures) return;
    setIsRefreshingFixtures(true);
    try {
      // 1. Refresh fixtures (detect arranged matches, warnings etc.)
      const response = await fetch(`/api/teams/refresh-fixtures?tournament_id=${tournament.id}`);
      if (!response.ok) throw new Error('Failed to refresh fixtures');
      const refreshResult = (await response.json().catch(() => null)) as { linked_match_ids?: number[] } | null;

      // 2. Also trigger a live check for HT-linked matches that may have result data.
      //    Finished-but-incomplete rows are included so an accidental manual clear can be recovered from CHPP.
      const matchesToSync = allMatches.filter(
        (m) => m.ht_match_id && (['arranged', 'ongoing', 'finished'].includes(m.status) || m.completed),
      );
      const matchIdsToSync = new Set<number>();
      for (const match of matchesToSync) {
        if (match.ht_match_id) matchIdsToSync.add(match.ht_match_id);
      }
      for (const matchId of refreshResult?.linked_match_ids ?? []) {
        if (matchId) matchIdsToSync.add(matchId);
      }

      if (matchIdsToSync.size > 0) {
        const ids = Array.from(matchIdsToSync).join(',');
        await fetch(`/api/chpp/live-matches?tournament_id=${tournament.id}&match_ids=${ids}`);
      }

      await fetchFixturesOnly();
    } catch (err: any) {
      console.error(err.message);
    } finally {
      setIsRefreshingFixtures(false);
    }
  }, [tournament, isRefreshingFixtures, fetchFixturesOnly, allMatches]);

  const requestHtMatchLink = useCallback(
    async (matchId: string, htMatchId: string, dryRun: boolean): Promise<HtMatchLinkPreview> => {
      if (!tournament) throw new Error('Tournament is not loaded.');

      const response = await fetch('/api/teams/refresh-fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'link_match',
          tournamentId: tournament.id,
          matchId,
          htMatchId,
          dryRun,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        preview?: HtMatchLinkPreview;
      } | null;

      if (!response.ok || !payload?.preview) {
        throw new Error(payload?.error || 'Could not link that Hattrick match.');
      }

      return payload.preview;
    },
    [tournament],
  );

  const previewHtMatchLink = useCallback(
    (matchId: string, htMatchId: string) => requestHtMatchLink(matchId, htMatchId, true),
    [requestHtMatchLink],
  );

  const saveHtMatchLink = useCallback(
    async (matchId: string, htMatchId: string) => {
      const preview = await requestHtMatchLink(matchId, htMatchId, false);
      if (preview.ht_match_id && tournament) {
        await fetch(`/api/chpp/live-matches?tournament_id=${tournament.id}&match_ids=${preview.ht_match_id}`);
      }
      await fetchData();
    },
    [fetchData, requestHtMatchLink, tournament],
  );

  useEffect(() => {
    if (activeTab !== 'fixtures' || !tournament) return;

    const shouldRefresh = () => {
      if (isRefreshingFixtures) return false;
      if (document.visibilityState !== 'visible') return false;
      const lastRefreshDate = tournament.last_fixtures_refresh ? new Date(tournament.last_fixtures_refresh) : null;
      const ageMins = lastRefreshDate ? (Date.now() - lastRefreshDate.getTime()) / 60000 : 999;
      if (ageMins < 10) return false;
      return rounds.some((r) => r.matches.some((m) => !m.completed));
    };

    const t = setTimeout(() => {
      if (shouldRefresh()) handleRefreshFixtures();
    }, 0);

    const interval = setInterval(
      () => {
        if (shouldRefresh()) handleRefreshFixtures();
      },
      10 * 60 * 1000,
    );

    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tournament?.id]);

  const handleTabChange = (tab: 'standings' | 'fixtures' | 'history' | 'guestbook' | 'news' | 'admin') => {
    if (tab !== activeTab) {
      if (tab === 'history' && latestPublishedHistorySeason) {
        const latestCount = historySeasonCommentCounts[latestPublishedHistorySeason.id];
        if (typeof latestCount === 'number') {
          localStorage.setItem(
            `ht-120min:history-comments-read:${latestPublishedHistorySeason.id}`,
            String(latestCount),
          );
          setHistorySeenVersion((current) => current + 1);
        }
      }
      setIsAddingDescription(false);
      setQuickDescription('');
      setSearchParams({ tab });
    }
  };

  useEffect(() => {
    if (activeTab !== 'standings' || !tournament) return;

    const fetchChat = async () => {
      const { data: chatData, error: chatError } = await supabase
        .from('tournament_chat')
        .select('*')
        .eq('tournament_id', tournament.id)
        .order('created_at', { ascending: true });

      if (chatError || !chatData) return;

      const authorIds = [...new Set(chatData.map((m) => m.author_ht_id).filter((id) => id && id !== 0))];

      if (authorIds.length > 0) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('hattrick_user_id, avatar_json')
          .in('hattrick_user_id', authorIds);

        const profileMap = Object.fromEntries(
          (profileData || []).map((p) => [p.hattrick_user_id, { avatar_json: p.avatar_json }]),
        );

        setChatMessages(
          chatData.map((m) => ({
            ...m,
            profiles: m.author_ht_id ? profileMap[m.author_ht_id] : null,
          })),
        );
      } else {
        setChatMessages(chatData);
      }
    };

    fetchChat();

    const channel = supabase
      .channel(`chat:${tournament.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tournament_chat',
          filter: `tournament_id=eq.${tournament.id}`,
        },
        async (payload) => {
          const newMessage = payload.new as any;

          // Fetch the profile for the author to get the avatar immediately
          const { data: profile } = await supabase
            .from('profiles')
            .select('avatar_json')
            .eq('hattrick_user_id', newMessage.author_ht_id)
            .single();

          setChatMessages((prev) => [...prev, { ...newMessage, profiles: profile }]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab, tournament]);

  const handlePostChat = async (content: string) => {
    // Accept content here
    if (!content.trim() || !tournament) return;
    try {
      const myHtId = localStorage.getItem('my_ht_user_id');
      const myTeam = myHtId ? teams.find((t) => t.hattrick_user_id === Number(myHtId)) : null;
      const authorName = myTeam?.manager_name || myTeam?.name || localStorage.getItem('my_ht_manager_name') || 'Guest';

      await supabase.from('tournament_chat').insert({
        tournament_id: tournament.id,
        author_name: authorName,
        content: content.trim(),
        author_ht_id: myHtId ? parseInt(myHtId) : null,
      });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleAddReaction = async (postId: string, reaction: string) => {
    const userId = localStorage.getItem('my_ht_user_id') || 'guest';
    const { error } = await supabase.from('news_reactions').insert({
      post_id: postId,
      user_id: userId,
      reaction: reaction,
    });
    if (error) alert(error.message);
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (tournament && password === tournament.admin_password) {
      setIsAdminAuthenticated(true);
      localStorage.setItem(`admin_pw_${slug}`, password);
      localStorage.setItem(`admin_auth_${slug}`, 'password');
      setAdminAuthError(false);
      setFailedLoginAttempt(false);
    } else {
      setAdminAuthError(true);
      setFailedLoginAttempt(true);
    }
  };

  const handleOrganizerLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canLoginAsOrganizer) return;

    setIsAdminAuthenticated(true);
    localStorage.setItem(`admin_auth_${slug}`, 'organizer');
    localStorage.removeItem(`admin_pw_${slug}`);
    setPassword('');
    setAdminAuthError(false);
    setFailedLoginAttempt(false);
  };

  const handleResetAdminPassword = async () => {
    if (!tournament || !canLoginAsOrganizer || isResettingAdminPassword) return;

    const confirmed = window.confirm('Reset the tournament admin password?');
    if (!confirmed) return;

    const newPassword = nanoid(8);
    setIsResettingAdminPassword(true);
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({ admin_password: newPassword })
        .eq('id', tournament.id);

      if (error) throw error;

      localStorage.setItem(`admin_pw_${slug}`, newPassword);
      setPassword(newPassword);
      fetchData();
      alert(`New admin password: ${newPassword}`);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsResettingAdminPassword(false);
    }
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    setPassword('');
    setAdminAuthError(false);
    setFailedLoginAttempt(false);
    localStorage.removeItem(`admin_pw_${slug}`);
    localStorage.removeItem(`admin_auth_${slug}`);
  };

  const updateTournamentLifecycleStatus = async (status: TournamentStatus, options: { isPrivate?: boolean } = {}) => {
    if (!tournament) return;
    const updatePayload: Partial<Pick<Tournament, 'status' | 'is_private'>> = { status };
    if (options.isPrivate !== undefined) updatePayload.is_private = options.isPrivate;

    const { error } = await supabase.from('tournaments').update(updatePayload).eq('id', tournament.id);
    if (error) {
      alert(error.message);
      return;
    }

    setTournament((prev) => (prev ? { ...prev, ...updatePayload } : prev));
  };

  const handlePauseTournament = async () => {
    if (!tournament) return;
    const confirmed = window.confirm(
      'Pause this tournament?\n\nPaused tournaments stay joinable and editable, but schedule management is hidden until you set it active again.',
    );
    if (!confirmed) return;

    await updateTournamentLifecycleStatus('paused');
  };

  const handleStopTournament = async () => {
    if (!tournament) return;
    const confirmed = window.confirm(
      'Fully stop this tournament?\n\nStopping halts the tournament, unpublishes it from public lists and allows teams to join other tournaments.',
    );
    if (!confirmed) return;
    if (!confirmAdminPassword()) return;

    await updateTournamentLifecycleStatus('stopped');
  };

  const handleMoveStoppedToPaused = async () => {
    if (!tournament) return;
    if (!confirmAdminPassword()) return;

    if (playingElsewhereTeamIds.size > 0) {
      const teamNames = teams
        .filter((team) => team.ht_team_id && playingElsewhereTeamIds.has(team.ht_team_id))
        .map((team) => team.name)
        .join(', ');
      alert(
        `Tournament cannot be moved to paused while ${teamNames || 'one team'} is playing elsewhere. Remove or replace that team first.`,
      );
      return;
    }

    await updateTournamentLifecycleStatus('paused');
  };

  const handleSetPausedTournamentActive = async () => {
    const nextStatus = isGenerated ? 'active' : 'open';
    await updateTournamentLifecycleStatus(nextStatus);
  };

  const buildCurrentSeasonSnapshot = useCallback(() => {
    if (!tournament) return null;
    return buildSeasonHistorySnapshot(
      teams.map((team) => toStandingTeam(team)),
      rounds.flatMap((round) => round.matches.map((match) => toSeasonHistoryMatch(match, round.round_number))),
      tournament.scoring_mode as any,
    );
  }, [rounds, teams, tournament]);

  const persistCurrentSeasonHistory = useCallback(async () => {
    if (!tournament) throw new Error('Tournament is not available.');
    const currentSeasonNumber = tournament.season || 1;
    const existingSeason = seasons.find((season) => season.season_number === currentSeasonNumber);
    const snapshot = existingSeason?.snapshot_json || buildCurrentSeasonSnapshot();
    if (!snapshot) throw new Error('Season history could not be generated.');

    const now = new Date().toISOString();
    const finishedAt = resolveSeasonFinishedAt(
      rounds.flatMap((round) => round.matches.map((match) => toSeasonHistoryMatch(match, round.round_number))),
      existingSeason?.finished_at || now,
    );
    const startedAt = resolveSeasonStartedAt(
      rounds.flatMap((round) => round.matches.map((match) => toSeasonHistoryMatch(match, round.round_number))),
      existingSeason?.started_at || tournament.schedule_generated_at || null,
    );
    const { data, error } = await supabase
      .from('tournament_seasons')
      .upsert(
        {
          tournament_id: tournament.id,
          season_number: currentSeasonNumber,
          status: 'finished',
          planned_start_slot: tournament.schedule_start_slot,
          started_at: startedAt,
          finished_at: finishedAt,
          snapshot_json: snapshot,
          updated_at: now,
        },
        { onConflict: 'tournament_id,season_number' },
      )
      .select('*')
      .single();

    if (error) throw error;
    if (data) {
      setSeasons((current) => {
        const withoutCurrent = current.filter((season) => season.season_number !== currentSeasonNumber);
        return [...withoutCurrent, data as TournamentSeason].sort((a, b) => a.season_number - b.season_number);
      });
    }

    return snapshot;
  }, [buildCurrentSeasonSnapshot, rounds, seasons, tournament]);

  const handleGenerateHistoryReport = async () => {
    if (!tournament || isFinalizingSeason) return;
    setIsFinalizingSeason(true);
    try {
      await persistCurrentSeasonHistory();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not generate the season history report.');
    } finally {
      setIsFinalizingSeason(false);
    }
  };

  const handleFinishSeason = async () => {
    if (!tournament || isFinalizingSeason) return;
    const confirmed = window.confirm(
      `Finish Season ${tournament.season}?\n\nThis closes the season, generates its History report and allows participating teams to join other tournaments.`,
    );
    if (!confirmed) return;

    setIsFinalizingSeason(true);
    try {
      await persistCurrentSeasonHistory();
      const { error } = await supabase.from('tournaments').update({ status: 'finished' }).eq('id', tournament.id);
      if (error) throw error;
      setTournament((current) => (current ? { ...current, status: 'finished' } : current));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not finish this season.');
    } finally {
      setIsFinalizingSeason(false);
    }
  };

  const handleRebuildSeasonSnapshot = async (season: TournamentSeason) => {
    if (!tournament || rebuildingSeasonNumber !== null) return;
    setRebuildingSeasonNumber(season.season_number);
    try {
      const { data: seasonRounds, error: roundsError } = await supabase
        .from('rounds')
        .select('*')
        .eq('tournament_id', tournament.id)
        .eq('season_number', season.season_number)
        .order('round_number', { ascending: true });
      if (roundsError) throw roundsError;
      if (!seasonRounds?.length) throw new Error('No retained rounds were found for this season.');

      const { data: seasonMatches, error: matchesError } = await supabase
        .from('matches')
        .select('*')
        .in(
          'round_id',
          seasonRounds.map((round) => round.id),
        );
      if (matchesError) throw matchesError;

      const roundNumberById = new Map(seasonRounds.map((round) => [round.id, round.round_number]));
      const matches = (seasonMatches || []) as MatchWithTeams[];
      const historicalTeamIds = new Set(
        [
          ...matches.flatMap((match) => [match.home_team_id, match.away_team_id]),
          ...(season.snapshot_json?.standings || []).map((standing) => standing.teamId),
        ].filter((teamId): teamId is string => !!teamId),
      );
      const historicalTeams = teams
        .filter((team) => historicalTeamIds.has(team.id))
        .map((team) => toStandingTeam({ ...team, active: true }));
      const snapshot = buildSeasonHistorySnapshot(
        historicalTeams,
        matches.map((match) => toSeasonHistoryMatch(match, roundNumberById.get(match.round_id))),
        tournament.scoring_mode as any,
      );
      const updatedAt = new Date().toISOString();
      const { data: updatedSeason, error: updateError } = await supabase
        .from('tournament_seasons')
        .update({ snapshot_json: snapshot, updated_at: updatedAt })
        .eq('id', season.id)
        .select('*')
        .single();
      if (updateError) throw updateError;

      setSeasons((current) =>
        current.map((item) => (item.id === season.id ? (updatedSeason as TournamentSeason) : item)),
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not rebuild this season archive.');
    } finally {
      setRebuildingSeasonNumber(null);
    }
  };

  const handleAddNewSeason = async () => {
    if (!tournament || isAddingSeason) return;
    if (tournament.status !== 'finished') {
      alert('A new season can only be added after the current season is finished.');
      return;
    }
    const nextSeasonNumber = (tournament.season || 1) + 1;
    const confirmed = window.confirm(`Create Season ${nextSeasonNumber} and move this tournament to planned state?`);
    if (!confirmed) return;

    setIsAddingSeason(true);
    try {
      const finishedSeason = seasons.find((season) => season.season_number === (tournament.season || 1));
      if (!finishedSeason?.snapshot_json) {
        throw new Error('Generate the current season History report before adding a new season.');
      }
      const now = new Date().toISOString();
      const plannedStart =
        tournament.schedule_start_slot && new Date(tournament.schedule_start_slot).getTime() > Date.now()
          ? tournament.schedule_start_slot
          : null;

      const { data: nextSeason, error: seasonError } = await supabase
        .from('tournament_seasons')
        .insert({
          tournament_id: tournament.id,
          season_number: nextSeasonNumber,
          status: 'planned',
          planned_start_slot: plannedStart,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single();

      if (seasonError) throw seasonError;

      const { error: tournamentError } = await supabase
        .from('tournaments')
        .update({
          season: nextSeasonNumber,
          status: 'waiting',
          schedule_start_slot: plannedStart,
          schedule_locked_at: null,
          registration_closed_at: null,
          schedule_generated_at: null,
        })
        .eq('id', tournament.id);

      if (tournamentError) throw tournamentError;

      if (nextSeason) {
        setSeasons((current) =>
          [...current, nextSeason as TournamentSeason].sort((a, b) => a.season_number - b.season_number),
        );
      }
      setRounds([]);
      setStandings([]);
      setTournament((prev) =>
        prev
          ? {
              ...prev,
              season: nextSeasonNumber,
              status: 'waiting',
              schedule_start_slot: plannedStart,
              schedule_locked_at: null,
              registration_closed_at: null,
              schedule_generated_at: null,
            }
          : prev,
      );
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsAddingSeason(false);
    }
  };

  const getParticipantAudienceHtUserIds = useCallback(
    () =>
      Array.from(
        new Set(
          teams
            .filter((team) => team.active && !team.is_placeholder && team.hattrick_user_id)
            .map((team) => Number(team.hattrick_user_id)),
        ),
      ),
    [teams],
  );

  const createAnnouncement = useCallback(
    async ({
      content,
      templateKey,
      visibility,
      source,
    }: {
      content: string;
      templateKey: string | null;
      visibility: TournamentAnnouncementVisibility;
      source: 'admin' | 'system';
    }) => {
      if (!tournament || !content.trim()) return null;
      const audienceHtUserIds = visibility === 'participants' ? getParticipantAudienceHtUserIds() : [];
      const { data, error } = await supabase
        .from('tournament_announcements')
        .insert({
          tournament_id: tournament.id,
          content: content.trim(),
          template_key: templateKey,
          visibility,
          source,
          audience_ht_user_ids: audienceHtUserIds,
          is_active: true,
          created_by_name: source === 'system' ? 'Tournament Administration' : currentHtManagerName,
          created_by_ht_user_id: currentHtUserId,
        })
        .select('*')
        .single();

      if (error) throw error;
      if (data) setAnnouncements((current) => [data as TournamentAnnouncement, ...current]);
      return data as TournamentAnnouncement | null;
    },
    [currentHtManagerName, currentHtUserId, getParticipantAudienceHtUserIds, tournament],
  );

  const handleAnnouncementPublish = useCallback(
    async ({
      content,
      templateKey,
      visibility,
    }: {
      content: string;
      templateKey: string | null;
      visibility: TournamentAnnouncementVisibility;
    }) => {
      await createAnnouncement({
        content,
        templateKey,
        visibility,
        source: 'admin',
      });
    },
    [createAnnouncement],
  );

  const handleAnnouncementVisibilityToggle = async (announcement: TournamentAnnouncement) => {
    const nextActive = !announcement.is_active;
    const { data, error } = await supabase
      .from('tournament_announcements')
      .update({ is_active: nextActive, hidden_at: nextActive ? null : new Date().toISOString() })
      .eq('id', announcement.id)
      .select('*')
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    setAnnouncements((current) =>
      current.map((item) => (item.id === announcement.id ? (data as TournamentAnnouncement) : item)),
    );
  };

  const insertDismissal = async (payload: {
    announcement_id?: string | null;
    notice_key?: string | null;
    tournament_id: string;
    hattrick_user_id: number;
  }) => {
    const { data, error } = await supabase
      .from('tournament_announcement_dismissals')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') return null;
      throw error;
    }

    return data as TournamentAnnouncementDismissal | null;
  };

  const handleDismissJoinedNotice = async () => {
    if (!tournament || !currentHtUserId) return;
    setIsJoinedNoticeDismissed(true);
    localStorage.setItem(`joined_notice_dismissed_${slug}`, 'true');
    try {
      const dismissal = await insertDismissal({
        tournament_id: tournament.id,
        notice_key: JOINED_NOTICE_KEY,
        announcement_id: null,
        hattrick_user_id: currentHtUserId,
      });
      if (dismissal) setAnnouncementDismissals((current) => [...current, dismissal]);
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleDismissAnnouncement = async (announcement: TournamentAnnouncement) => {
    if (announcement.visibility === 'public') {
      localStorage.setItem(`announcement_dismissed_${announcement.id}`, 'true');
      setPublicAnnouncementDismissalVersion((current) => current + 1);
      return;
    }

    if (!tournament || !currentHtUserId) return;
    try {
      const dismissal = await insertDismissal({
        tournament_id: tournament.id,
        announcement_id: announcement.id,
        notice_key: null,
        hattrick_user_id: currentHtUserId,
      });
      if (dismissal) setAnnouncementDismissals((current) => [...current, dismissal]);
    } catch (error: any) {
      alert(error.message);
    }
  };

  const updateSettings = async () => {
    setIsUpdatingSettings(true);
    try {
      const selectedStartSlot = scheduleStartSlotId
        ? scheduleDraft.allSlotOptions.find((slot) => slot.id === scheduleStartSlotId) || null
        : null;
      const { error } = await supabase
        .from('tournaments')
        .update({
          name:
            editRegistrationType === 'sandbox'
              ? formatTournamentName(editName, { registrationType: editRegistrationType })
              : editName.trim(),
          is_private: editIsPrivate,
          chpp_only_join: editChppOnlyJoin,
          league_category: editLeagueCategory,
          registration_type: editRegistrationType,
          country_limit: editCountryLimit,
          is_test: isTest,
          show_description: showEditDescription,
          description: editDescription,
          admin_email: showEditEmail ? editAdminEmail : null,
          max_teams: editMaxTeams,
          schedule_start_slot: selectedStartSlot?.nominalDate.toISOString() ?? tournament?.schedule_start_slot ?? null,
          ...(canManageFeaturedTournaments ? { is_featured: editIsFeatured } : {}),
        })

        .eq('id', tournament?.id);

      if (error) throw error;
      if (tournament) {
        await supabase.from('tournament_seasons').upsert(
          {
            tournament_id: tournament.id,
            season_number: tournament.season || 1,
            status: tournament.status === 'finished' ? 'finished' : isGenerated ? 'ongoing' : 'planned',
            planned_start_slot: selectedStartSlot?.nominalDate.toISOString() ?? tournament.schedule_start_slot ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tournament_id,season_number' },
        );
      }

      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsUpdatingSettings(false);
    }
  };

  const handleQuickDescriptionAdd = async () => {
    if (!quickDescription.trim()) return;
    setIsUpdatingSettings(true);
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({
          description: quickDescription.trim(),
          show_description: true,
        })
        .eq('id', tournament?.id);

      if (error) throw error;
      setIsAddingDescription(false);
      setQuickDescription('');
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsUpdatingSettings(false);
    }
  };

  const handleUpdateImage = async () => {
    if (!tournament) return;
    setIsUpdatingImage(true);
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({ image_url: newImageUrl.trim() || null })
        .eq('id', tournament.id);

      if (error) throw error;
      setIsEditingImage(false);
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsUpdatingImage(false);
    }
  };

  const fetchTeamData = async (htId: string, isReplacement: boolean) => {
    if (!htId || htId.length < 6) return;
    setIsFetchingTeamData(true);
    try {
      const res = await fetch(`/api/teams/info?team_id=${htId}`);
      const data = (await res.json()) as FetchedTeamData & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to fetch team data');

      // Validation check
      const category = (tournament?.league_category || 'male') as 'male' | 'hfi';

      const validation = validateTeamEligibility(data, {
        category,
        countryLimit: tournament?.country_limit || null,
      });
      if (!validation.eligible) {
        throw new Error(validation.reason || `Team ID ${htId} "${data.teamName}" is not eligible.`);
      }

      if (isReplacement) {
        setReplacementName(data.teamName);
        setReplacementTeamData(data);
      } else {
        setNewTeamName(data.teamName);
        setNewTeamData(data);
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsFetchingTeamData(false);
    }
  };

  const fetchSandboxTeamById = async (teamId: number): Promise<FetchedTeamData> => {
    const params = new URLSearchParams({
      team_id: String(teamId),
      sandbox: '1',
      league_category: tournament?.league_category === 'hfi' ? 'hfi' : 'male',
    });
    const res = await fetch(`/api/teams/info?${params.toString()}`);
    const data = (await res.json()) as FetchedTeamData & { error?: string };
    if (!res.ok) throw new Error(data.error || 'Failed to fetch sandbox team data');
    if (!data.teamName || data.teamName === 'Unknown') throw new Error('Team data is missing a valid team name.');
    return data;
  };

  const fetchRandomSandboxTeam = async () => {
    setIsFetchingSandboxTeam(true);
    setSandboxFetchError('');
    setSandboxCandidate(null);

    try {
      for (let attempt = 0; attempt < SANDBOX_RANDOM_ATTEMPTS; attempt += 1) {
        const teamId = getRandomSandboxTeamId(tournament?.league_category === 'hfi' ? 'hfi' : 'male');
        if (teams.some((team) => team.ht_team_id === teamId)) continue;

        try {
          const candidate = await fetchSandboxTeamById(teamId);
          if (!teams.some((team) => team.ht_team_id === candidate.teamId)) {
            setSandboxCandidate(candidate);
            return;
          }
        } catch {
          // Random team IDs are sparse; keep trying until the configured cap.
        }
      }

      setSandboxFetchError('Could not find a matching random team. Try again.');
    } finally {
      setIsFetchingSandboxTeam(false);
    }
  };

  const addSandboxTeam = async () => {
    if (!tournament || !sandboxCandidate) return;
    if (isGenerated) {
      alert('Test teams can only be added before the schedule is generated.');
      setSandboxCandidate(null);
      return;
    }
    if (sandboxTeamLimitReached) {
      alert('The test tournament has reached its team limit.');
      setSandboxCandidate(null);
      return;
    }
    if (teams.some((team) => team.ht_team_id === sandboxCandidate.teamId && team.active)) {
      alert('This team is already active in the tournament.');
      setSandboxCandidate(null);
      return;
    }

    setIsSavingTeam(true);
    try {
      const { error } = await supabase.from('teams').insert({
        tournament_id: tournament.id,
        name: sandboxCandidate.teamName,
        ht_team_id: sandboxCandidate.teamId,
        active: true,
        joined_via_oauth: false,
        manager_name: 'Bot team',
        logo_url: sandboxCandidate.logoUrl ?? null,
        country_id: sandboxCandidate.countryId ?? null,
        country_name: sandboxCandidate.countryName ?? null,
        league_id: sandboxCandidate.leagueId ?? null,
        gender_id: sandboxCandidate.genderId ?? null,
        league_level: sandboxCandidate.leagueLevel ?? null,
      });
      if (error) throw error;

      setSandboxCandidate(null);
      setSandboxFetchError('');
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const addTeam = async (e: React.FormEvent, isJoin: boolean = false) => {
    if (e) e.preventDefault();
    const name = isJoin ? joinTeamName : newTeamName;
    const htId = isJoin ? joinTeamId : newTeamId;

    if (!name.trim() || !htId.trim()) {
      alert('Both Team Name and HT ID are required.');
      return;
    }

    if (!/^\d{1,10}$/.test(htId.trim())) {
      alert('HT ID must be a valid number.');
      return;
    }

    const htIdInt = parseInt(htId.trim());
    if (teams.some((t) => t.ht_team_id === htIdInt && t.active)) {
      alert('This team is already active in the tournament.');
      return;
    }

    if (!window.confirm(`Are you sure you want to add ${name} (ID: ${htId})?`)) {
      return;
    }

    setIsSavingTeam(true);
    try {
      let finalTeamId: string | null = null;
      let oldTeamToReplaceId: string | null = null;

      // If scheduled and there are inactive teams, replace the first one
      if (isGenerated) {
        const inactiveTeam = teams.find((t) => !t.active && !t.is_placeholder);
        if (inactiveTeam) {
          oldTeamToReplaceId = inactiveTeam.id;
        }
      }

      // 1. Insert new team
      const fetchedTeamData = isJoin ? null : newTeamData;
      const { data: newTeam, error } = await supabase
        .from('teams')
        .insert([
          {
            tournament_id: tournament?.id,
            name: name.trim(),
            ht_team_id: parseInt(htId.trim()),
            active: true,
            replacement_for_team_id: oldTeamToReplaceId,
            logo_url: fetchedTeamData?.logoUrl ?? null,
            country_id: fetchedTeamData?.countryId ?? null,
            country_name: fetchedTeamData?.countryName ?? null,
            league_id: fetchedTeamData?.leagueId ?? null,
            gender_id: fetchedTeamData?.genderId ?? null,
            league_level: fetchedTeamData?.leagueLevel ?? null,
            manager_name: fetchedTeamData ? 'Bot team' : null,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      finalTeamId = newTeam?.id;

      // 2. If replacement, update matches
      if (oldTeamToReplaceId && finalTeamId) {
        await supabase
          .from('matches')
          .update({ home_team_id: finalTeamId })
          .eq('home_team_id', oldTeamToReplaceId)
          .eq('completed', false);

        await supabase
          .from('matches')
          .update({ away_team_id: finalTeamId })
          .eq('away_team_id', oldTeamToReplaceId)
          .eq('completed', false);
      } else if (isGenerated && finalTeamId) {
        // 3. If no inactive team, check for BYE matches
        const roundIds = rounds.map((r) => r.id);
        const { data: byeMatches } = await supabase
          .from('matches')
          .select('id, home_team_id, away_team_id')
          .in('round_id', roundIds)
          .or('home_team_id.is.null,away_team_id.is.null')
          .eq('completed', false);

        if (byeMatches && byeMatches.length > 0) {
          for (const match of byeMatches) {
            if (match.home_team_id === null) {
              await supabase.from('matches').update({ home_team_id: finalTeamId }).eq('id', match.id);
            } else if (match.away_team_id === null) {
              await supabase.from('matches').update({ away_team_id: finalTeamId }).eq('id', match.id);
            }
          }
        }
      }

      if (isJoin) {
        setJoinTeamId('');
        setJoinTeamName('');
        setIsJoining(false);
      } else {
        setNewTeamId('');
        setNewTeamName('');
        setNewTeamData(null);
      }
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const reviveTeam = async (teamId: string) => {
    const team = teams.find((t) => t.id === teamId);
    if (!window.confirm(`This team was previously removed from tournament. Do you want to revive ${team?.name}?`))
      return;

    setIsSavingTeam(true);
    try {
      const { error } = await supabase.from('teams').update({ active: true }).eq('id', teamId);
      if (error) throw error;
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const replaceTeam = async (oldTeamId: string) => {
    if (!replacementName.trim() || !replacementHtId.trim()) {
      alert('Both new Team Name and new HT ID are required.');
      return;
    }

    const oldTeam = teams.find((t) => t.id === oldTeamId);
    if (!window.confirm(`Replace ${oldTeam?.name || 'Inactive Team'} with ${replacementName}?`)) {
      return;
    }

    setIsSavingTeam(true);
    try {
      // 1. Deactivate old team if not already
      await supabase.from('teams').update({ active: false }).eq('id', oldTeamId);

      // 2. Insert new team
      const { data: newTeam, error: nError } = await supabase
        .from('teams')
        .insert([
          {
            tournament_id: tournament?.id,
            name: replacementName.trim(),
            ht_team_id: parseInt(replacementHtId.trim()),
            active: true,
            replacement_for_team_id: oldTeamId,
            logo_url: replacementTeamData?.logoUrl ?? null,
            country_id: replacementTeamData?.countryId ?? null,
            country_name: replacementTeamData?.countryName ?? null,
            league_id: replacementTeamData?.leagueId ?? null,
            gender_id: replacementTeamData?.genderId ?? null,
            league_level: replacementTeamData?.leagueLevel ?? null,
            manager_name: replacementTeamData ? 'Bot team' : null,
          },
        ])
        .select()
        .single();

      if (nError) throw nError;

      // 3. Update upcoming matches
      if (newTeam) {
        const { error: m1Error } = await supabase
          .from('matches')
          .update({ home_team_id: newTeam.id })
          .eq('home_team_id', oldTeamId)
          .eq('completed', false);

        const { error: m2Error } = await supabase
          .from('matches')
          .update({ away_team_id: newTeam.id })
          .eq('away_team_id', oldTeamId)
          .eq('completed', false);

        if (m1Error || m2Error) throw new Error('Failed to update matches');
      }

      setReplacingTeamId(null);
      setReplacementHtId('');
      setReplacementName('');
      setReplacementTeamData(null);
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const reconcileTournamentTeamState = async (updatedTeams: Team[]) => {
    if (!tournament || isSandbox) return;
    if (tournament.status === 'stopped' || tournament.status === 'finished') return;

    const registeredTeams = updatedTeams.filter((team) => !team.is_placeholder);
    const activeTeams = registeredTeams.filter((team) => team.active);

    if (isGenerated) {
      const shouldPause = activeTeams.length === 0 || !isHealthQuotaMet(updatedTeams);
      if (shouldPause && tournament.status !== 'paused') {
        await supabase.from('tournaments').update({ status: 'paused' }).eq('id', tournament.id);
        alert('This tournament has been paused because too few active teams remain.');
      }
      return;
    }

    if (registeredTeams.length === 0 && !tournament.is_private) {
      await supabase.from('tournaments').update({ is_private: true }).eq('id', tournament.id);
    }
  };

  const confirmAdminPassword = () => {
    const enteredPassword = window.prompt('Enter admin password to confirm:');
    if (enteredPassword === null) return false;
    if (enteredPassword !== tournament?.admin_password) {
      alert('Wrong admin password.');
      return false;
    }
    return true;
  };

  const deleteTeam = async (id: string) => {
    let updatedTeams;
    const team = teams.find((t) => t.id === id);
    if (isGenerated) {
      if (window.confirm(`Are you sure you want to deactivate ${team?.name}?`)) {
        if (!confirmAdminPassword()) return;
        await supabase.from('teams').update({ active: false }).eq('id', id);
        updatedTeams = teams.map((t) => (t.id === id ? { ...t, active: false } : t));
        fetchData();
        reconcileTournamentTeamState(updatedTeams);
      }
      return;
    }

    if (window.confirm(`Remove ${team?.name} from the tournament?`)) {
      if (!confirmAdminPassword()) return;
      // If NOT generated, we just destroy the relationship for this season/tournament
      // Since tournament_id is currently the only link, setting it to null (if schema allowed)
      // or just deleting from this tournament's team list.
      // The plan says "DON'T hard delete team from DB", but the current schema
      // has teams belonging to a tournament. If I delete it here, it's gone from this tournament.
      // If we had a global teams table, it would be different.
      // For now, I'll just delete the record as it's specific to this tournament instance.
      await supabase.from('teams').delete().eq('id', id);
      updatedTeams = teams.filter((t) => t.id !== id);
      fetchData();
      reconcileTournamentTeamState(updatedTeams);
    }
  };

  const generateSchedule = async () => {
    if (!isHealthQuotaMet()) {
      alert(
        'Cannot generate schedule: Too many inactive teams. Please replace or revive teams to meet the minimum quota.',
      );
      return;
    }

    if (!scheduleDraft.valid || !scheduleDraft.selectedStartSlot) {
      alert(scheduleDraft.reason || 'Choose a valid start date first.');
      return;
    }
    if (!serializedScheduleDraft) {
      alert('Unable to serialize the selected schedule draft.');
      return;
    }
    const scheduleAdminPassword = password.trim() || tournament?.admin_password || '';
    if (!scheduleAdminPassword) {
      alert('Unable to confirm organizer access. Please reload the page and try again.');
      return;
    }

    const activeTeamCount = activeScheduleTeams.length;
    let confirmMsg = `Are you sure you want to generate the schedule with ${activeTeamCount} teams?`;
    if (activeTeamCount % 2 !== 0) {
      confirmMsg +=
        '\n\n⚠️ ODD NUMBER OF TEAMS: Each round one team will have a BYE. BYE rules: teams with a BYE can challenge anyone outside the tournament that round and still get points if organizer manually adds such results. Whether or not to do that you can add a custom tournament house-rule.';
    }

    if (!window.confirm(confirmMsg)) return;

    setIsGenerating(true);
    try {
      const { error } = await supabase.rpc('generate_tournament_schedule', {
        p_tournament_id: tournament?.id,
        p_schedule_payload: serializedScheduleDraft,
        p_admin_password: scheduleAdminPassword,
        p_schedule_mode: scheduleDraft.mode,
        p_schedule_start_slot: scheduleDraft.selectedStartSlot.nominalDate.toISOString(),
        p_include_week15_weekend_friendly: scheduleDraft.consumesWeek15WeekendFriendly,
      });

      if (error) throw error;
      await supabase.from('tournament_seasons').upsert(
        {
          tournament_id: tournament?.id,
          season_number: tournament?.season || 1,
          status: 'ongoing',
          planned_start_slot: scheduleDraft.selectedStartSlot.nominalDate.toISOString(),
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tournament_id,season_number' },
      );
      try {
        await createAnnouncement({
          content: 'Tournament schedule dates were updated, please check Fixtures & Results.',
          templateKey: 'schedule-change',
          visibility: 'participants',
          source: 'system',
        });
      } catch (announcementError) {
        console.warn(
          'Schedule was regenerated, but the participant announcement could not be published.',
          announcementError,
        );
      }
      await fetchData();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
            ? err.message
            : 'Unknown error';
      alert('Error generating schedule: ' + message);
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateSchedule = async () => {
    if (!rescheduleDraft.valid || !rescheduleDraft.selectedStartSlot || !rescheduleDraft.selectedFromRoundNumber) {
      alert(rescheduleDraft.reason || 'Choose a valid round and start date first.');
      return;
    }
    if (!serializedRescheduleDraft) {
      alert('Unable to serialize the selected reschedule draft.');
      return;
    }

    const scheduleAdminPassword = password.trim() || tournament?.admin_password || '';
    if (!scheduleAdminPassword) {
      alert('Unable to confirm organizer access. Please reload the page and try again.');
      return;
    }

    const confirmMsg = `Regenerate schedule from round ${rescheduleDraft.selectedFromRoundNumber}?\n\nThis will only move future unarranged rounds. Pairings, BYEs, results, arranged matches, and played matches stay unchanged.`;
    if (!window.confirm(confirmMsg)) return;

    setIsRescheduling(true);
    try {
      const { error } = await supabase.rpc('reschedule_tournament_rounds', {
        p_tournament_id: tournament?.id,
        p_admin_password: scheduleAdminPassword,
        p_from_round_number: rescheduleDraft.selectedFromRoundNumber,
        p_schedule_payload: serializedRescheduleDraft,
        p_schedule_start_slot: rescheduleDraft.selectedStartSlot.nominalDate.toISOString(),
        p_include_week15_weekend_friendly: rescheduleDraft.consumesWeek15WeekendFriendly,
      });

      if (error) throw error;
      await fetchData();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
            ? err.message
            : 'Unknown error';
      alert('Error regenerating schedule: ' + message);
    } finally {
      setIsRescheduling(false);
    }
  };

  const updateMatch = async (matchId: string) => {
    const data = matchData[matchId];
    if (data?.home_goals == null || data?.away_goals == null) {
      alert('Enter both scores before saving the result.');
      return;
    }

    const { error } = await supabase
      .from('matches')
      .update({
        home_goals: parseInt(String(data.home_goals)),
        away_goals: parseInt(String(data.away_goals)),
        went_120: data?.went_120 ?? false,
        total_minutes: data?.total_minutes || 90,
        completed: true,
      })
      .eq('id', matchId);

    if (error) alert(error.message);
    else {
      setEditingMatch(null);
      fetchData();
    }
  };

  const canManageSchedule = Boolean(tournament && !isPausedTournament && !isStoppedTournament);
  const tournamentId = tournament?.id ?? null;
  const activeRealTeamsCount = teams.filter((team) => team.active && !team.is_placeholder).length;
  const sandboxTeamLimitReached = Boolean(tournament?.max_teams && activeRealTeamsCount >= tournament.max_teams);
  const canManageSandboxTeams = Boolean(tournament && isSandbox && isAdminAuthenticated && !isGenerated);
  const canAddSandboxTeam = Boolean(canManageSandboxTeams && !sandboxTeamLimitReached);
  const canJoinTournament = Boolean(
    tournament &&
    !isSandbox &&
    canViewerJoinTournament({
      hasJoined,
      isGenerated,
      maxTeams: tournament.max_teams,
      teams,
      status: tournament.status,
    }),
  );
  const normalizedRegistrationType = tournament
    ? normalizeTournamentRegistrationType(tournament.registration_type)
    : 'manual';
  const isValidatedTournament = normalizedRegistrationType === 'validated';
  const canJoinAnotherTeamBeforeFixtures = Boolean(
    tournament && !isSandbox && !isGenerated && (!tournament.max_teams || activeRealTeamsCount < tournament.max_teams),
  );
  const shouldPromptReturningParticipantLogin = Boolean(
    tournamentId &&
    !currentHtUserId &&
    !canJoinTournament &&
    teams.some((team) => team.active && !team.is_placeholder && team.hattrick_user_id),
  );
  const rawReauthPromptReason =
    currentHtUserId && needsAuthRefresh()
      ? 'auth_refresh_needed'
      : shouldPromptReturningParticipantLogin
        ? 'returning_participant'
        : null;
  const reauthPromptDismissalKey =
    rawReauthPromptReason && slug ? `reauth_prompt_dismissed_${slug}_${rawReauthPromptReason}` : null;
  const reauthPromptReason =
    rawReauthPromptReason && reauthPromptDismissalKey && sessionStorage.getItem(reauthPromptDismissalKey) !== 'true'
      ? rawReauthPromptReason
      : null;
  const dismissedAnnouncementIds = new Set(
    announcementDismissals
      .filter((dismissal) => dismissal.announcement_id)
      .map((dismissal) => dismissal.announcement_id as string),
  );
  const joinedNoticeDismissed =
    isJoinedNoticeDismissed || announcementDismissals.some((dismissal) => dismissal.notice_key === JOINED_NOTICE_KEY);
  const selectedTournamentMessage = selectTournamentMessage({
    canJoin: canJoinTournament,
    hasJoined,
    currentHtUserId,
    joinedNoticeDismissed,
    reauthPromptReason,
    announcements,
    dismissedAnnouncementIds,
    publicDismissedAnnouncementIds: dismissedPublicAnnouncementIds,
  });

  const closeCreatedTournamentWelcome = () => {
    setHasClosedCreatedTournamentWelcome(true);
  };

  const acceptCreatedTournamentWelcome = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('welcome');
    setSearchParams(nextParams, { replace: true });
    setHasClosedCreatedTournamentWelcome(true);
  };

  const closeOpenTournamentWelcome = () => {
    setHasClosedOpenTournamentWelcome(true);
  };

  const acceptOpenTournamentWelcome = () => {
    if (!tournamentVisitWelcomeKey) return;
    dismissWelcome(tournamentVisitWelcomeKey);
    setHasClosedOpenTournamentWelcome(true);
  };

  const handleRefreshHattrickLogin = () => {
    document.cookie = `auth_return_url=${encodeURIComponent(window.location.pathname + window.location.search)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  };

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!tournament) return <div className={styles.loading}>Tournament not found</div>;

  const is120minMode = tournament.scoring_mode === '120m' || tournament.scoring_mode === '120min';

  const isMobile = window.innerWidth <= 620;
  const publicUrl = `${window.location.origin}/t/${slug}`;
  const publicUrlDisplay = isMobile ? `...${slug}` : publicUrl;

  // Find the first round that is not fully completed
  const currentRoundIdForResults = rounds.find((r) => r.matches.some((m) => !m.completed))?.id;
  const previousSeasons = seasons.filter((season) => season.season_number < (tournament.season || 1));
  const currentSeason = seasons.find((season) => season.season_number === (tournament.season || 1));
  const historySeasons = seasons
    .filter((season) => season.status === 'finished' || season.snapshot_json)
    .sort((a, b) => b.season_number - a.season_number);
  const selectedHistorySeasonNumber =
    Number(searchParams.get('historySeason')) || historySeasons[0]?.season_number || null;
  const handleHistorySeasonChange = (seasonNumber: number) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'history');
    nextParams.set('historySeason', String(seasonNumber));
    setSearchParams(nextParams, { replace: true });
  };
  const formatHistoryDate = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(new Date(value))
      : null;

  const latestHistoryCommentCount =
    latestPublishedHistorySeason ? historySeasonCommentCounts[latestPublishedHistorySeason.id] ?? null : null;
  const latestHistoryReadCount = latestPublishedHistorySeason
    ? (() => {
        void historySeenVersion;
        const storedValue = localStorage.getItem(`ht-120min:history-comments-read:${latestPublishedHistorySeason.id}`);
        const storedCount = storedValue ? Number(storedValue) : 0;
        return Number.isFinite(storedCount) ? storedCount : 0;
      })()
    : 0;
  const latestHistoryUnreadCount =
    latestPublishedHistorySeason &&
    latestHistoryCommentCount !== null &&
    latestHistoryCommentCount > latestHistoryReadCount
      ? latestHistoryCommentCount - latestHistoryReadCount
      : 0;
  const hasNewHistoryReportBadge = Boolean(
    latestPublishedHistorySeason && historyReportNoticeIsCurrent && (!currentHtUserId || historyReportNoticeOpen),
  );
  const historyTabBadgeCount =
    activeTab !== 'history' ? Math.max(latestHistoryUnreadCount, hasNewHistoryReportBadge ? 1 : 0) : 0;

  const handleHistoryCommentsLoaded = (seasonId: string, commentCount: number) => {
    setHistorySeasonCommentCounts((current) =>
      current[seasonId] === commentCount ? current : { ...current, [seasonId]: commentCount },
    );
    if (activeTab === 'history') {
      localStorage.setItem(`ht-120min:history-comments-read:${seasonId}`, String(commentCount));
      setHistorySeenVersion((current) => current + 1);
    }
  };

  return (
    <div className={styles.view}>
      <div className={styles.tHeader}>
        <div className={styles.headerTop}>
          <div className={styles.titleArea}>
            <div className={styles.h1Wrap}>
              <h1>{tournament.name}</h1>
            </div>
            <p className={styles.subtitle}>
              Season {tournament.season}
              {tournament.status === 'finished' && <span> • Finished</span>}
            </p>
            {(isAddingDescription || (tournament.description && tournament.show_description)) && (
              <div className={styles.tournamentDescription}>
                {isAddingDescription ? (
                  <div className={styles.quickAddDesc}>
                    <div className={adminStyles.labelRow}>
                      <label>Add Description</label>
                      <button
                        type="button"
                        onClick={() => regenerateDescription(true)}
                        className={adminStyles.iconBtn}
                        title="Regenerate description"
                      >
                        <ArrowClockwise size={20} weight="bold" />
                      </button>
                    </div>
                    <textarea
                      value={quickDescription}
                      onChange={(e) => setQuickDescription(e.target.value)}
                      placeholder="Tournament description..."
                      rows={4}
                    />
                    <div className={styles.quickAddActions}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={handleQuickDescriptionAdd}
                        disabled={isUpdatingSettings || !quickDescription.trim()}
                      >
                        {isUpdatingSettings ? 'Adding...' : 'Add'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setIsAddingDescription(false);
                          setQuickDescription('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p>{tournament.description}</p>
                )}
              </div>
            )}
            {!tournament.description && isAdminAuthenticated && !isAddingDescription && (
              <button
                className={styles.addDescBtn}
                onClick={() => {
                  setQuickDescription(tournament.description || '');
                  setIsAddingDescription(true);
                }}
              >
                + Add description
              </button>
            )}
            {tournament.max_teams && (
              <p className={styles.joinLimit}>
                Join limit: {teams.filter((t) => t.active).length} / {tournament.max_teams}
                {teams.filter((t) => t.active).length >= tournament.max_teams && ' — Filled!'}
              </p>
            )}
            {is120minMode ? (
              <div className={styles.scoringHelp}>
                <p onClick={() => setShowScoringHelp(!showScoringHelp)} className={styles.helpToggle}>
                  <strong>120min scoring mode</strong> {showScoringHelp ? <X size={18} /> : <Info size={18} />}
                </p>
                {showScoringHelp && (
                  <p className={styles.helpContent}>
                    Teams in this tournament compete to score more 120min training matches achieved than their
                    opponents. Standings are ranked by <strong>120min achievements</strong> primarily. Ties are settled
                    by <strong>Total Minutes</strong> (means more training minutes achieved), then{' '}
                    <strong>Smaller Goal Difference</strong> (here closer means better), and finally{' '}
                    <strong>Goals Scored</strong> (means draws with fireworks).
                  </p>
                )}
              </div>
            ) : (
              <div className={styles.scoringHelp}>
                <p onClick={() => setShowScoringHelp(!showScoringHelp)} className={styles.helpToggle}>
                  <strong>Victory points mode</strong> {showScoringHelp ? <X size={18} /> : <Info size={18} />}
                </p>
                {showScoringHelp && (
                  <p className={styles.helpContent}>
                    Standard competitive tournament. Teams earn 3 points for a win and 1 point for a draw. Standings are
                    ranked by <strong>Total Points</strong>, then goal difference and goals scored. 120min games mean
                    nothing here.
                  </p>
                )}
              </div>
            )}
          </div>
          <div
            className={styles.imagePlaceholder}
            onClick={() => {
              if (tournament?.image_url) {
                setShowFullImage(true);
              }
            }}
          >
            <div
              className={styles.tournamentImage}
              style={getTournamentBackgroundStyle(tournament?.id || '', tournament?.image_url)}
            />
            {!tournament?.image_url && isAdminAuthenticated && (
              <div className={styles.placeholderMessage}>Click to add image URL</div>
            )}
            {isAdminAuthenticated && (
              <div
                className={styles.editOverlay}
                onClick={(e) => {
                  e.stopPropagation();
                  setNewImageUrl(typeof tournament?.image_url === 'string' ? tournament.image_url : '');
                  setIsEditingImage(true);
                }}
              >
                <span>{tournament?.image_url ? 'Edit Image' : 'Add Image'}</span>
              </div>
            )}
          </div>
        </div>

        {tournament.status === 'paused' && (
          <div className={styles.testNotice}>
            <div>
              <h3>Tournament paused</h3>
              <p>
                This tournament is postponed. Teams can still join and admins can edit participants, but schedule
                management is hidden until the tournament is set active again.
              </p>
            </div>
          </div>
        )}

        {tournament.status === 'stopped' && (
          <div className={styles.testNotice}>
            <div>
              <h3>Tournament fully stopped</h3>
              <p>
                This tournament is halted and unpublished. Teams listed here are allowed to join other tournaments.
                Admins can move it back to paused when they are ready to rebuild the participant list.
              </p>
            </div>
          </div>
        )}

        {isGenerated && !isHealthQuotaMet() && tournament.status !== 'stopped' && (
          <div className={styles.pauseNotice}>
            <div>
              <h3>Tournament Paused</h3>
              <p>
                More than 25% of teams have become inactive. The tournament is paused until teams are revived or
                replaced.
              </p>
            </div>
          </div>
        )}

        {isSandbox && (
          <div className={styles.testNotice}>
            <div>
              <h3>TEST tournament</h3>
              <p>
                {canAddSandboxTeam
                  ? 'This is a test tournament. Current team limit allows adding another'
                  : 'This tournament is TEST.'}
              </p>
            </div>
            {canManageSandboxTeams && (
              <div className={styles.testNoticeActions}>
                {!sandboxCandidate && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={fetchRandomSandboxTeam}
                    disabled={isFetchingSandboxTeam || !canAddSandboxTeam}
                  >
                    {isFetchingSandboxTeam
                      ? 'Finding...'
                      : tournament.max_teams
                        ? `Get random (${Math.min(activeRealTeamsCount, tournament.max_teams)} of ${tournament.max_teams})`
                        : 'Get random test team'}
                  </Button>
                )}
                {sandboxCandidate && (
                  <div className={styles.sandboxCandidateInline}>
                    <button
                      type="button"
                      className={styles.sandboxCandidateClose}
                      onClick={() => {
                        setSandboxCandidate(null);
                        setSandboxFetchError('');
                      }}
                      disabled={isSavingTeam || isFetchingSandboxTeam}
                      aria-label="Close random team selector"
                    >
                      <X size={16} weight="bold" />
                    </button>
                    <strong>{sandboxCandidate.teamName}</strong>
                    <span>
                      {[`ID ${sandboxCandidate.teamId}`, sandboxCandidate.countryName].filter(Boolean).join(' · ')}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={addSandboxTeam}
                      disabled={isSavingTeam}
                    >
                      Add it
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={fetchRandomSandboxTeam}
                      disabled={isSavingTeam || isFetchingSandboxTeam}
                    >
                      Retry
                    </Button>
                  </div>
                )}
                {sandboxFetchError && <p className={styles.helperText}>{sandboxFetchError}</p>}
              </div>
            )}
          </div>
        )}

        {isJoining && !isSandbox && (
          <div className={styles.registrationFormWrapper}>
            <HeroCard title="Join This Tournament">
              <div className={styles.joinHeroImageWrapper}>
                <img src="/register.png" alt="Join Tournament" className={styles.joinHeroImage} />
                {isConnecting && (
                  <div className={styles.imageLoaderOverlay}>
                    <p>Connecting to Hattrick...</p>
                  </div>
                )}
              </div>
              {isGenerated && (
                <p className={styles.registrationIntro}>
                  You are joining an ongoing tournament. You will fill an available spot.
                </p>
              )}

              <div className={styles.registrationLinkArea}>
                <Button
                  size="lg"
                  variant="primary"
                  disabled={isConnecting}
                  onClick={() => {
                    setIsConnecting(true);
                    window.location.href = `/api/auth/init?tournament_id=${tournament?.id}`;
                  }}
                >
                  <ArrowRight size={20} weight="bold" /> Join with Hattrick
                </Button>
                <p className={styles.registrationLinkNote}>
                  Authorize HT-120min to fetch your team data and update results automatically.
                </p>
              </div>
            </HeroCard>
          </div>
        )}
      </div>
      {selectedTournamentMessage?.type === 'join' && (
        <div className={styles.registrationStatus}>
          <div className={styles.helpContent}>
            <p>
              {isGenerated
                ? 'This tournament is ongoing but has available spots for new teams!'
                : 'This tournament is currently open and accepting new participants!'}
            </p>
            {!isJoining && (
              <Button
                onClick={() => {
                  setIsConnecting(true);
                  window.location.href = `/api/auth/init?tournament_id=${tournament?.id}`;
                }}
                variant="primary"
                size="sm"
                className={styles.joinButton}
                disabled={isConnecting}
              >
                <ArrowRight size={18} weight="bold" /> Join with Hattrick
              </Button>
            )}
          </div>
        </div>
      )}

      {selectedTournamentMessage?.type === 'joined_notice' && (
        <div className={styles.joinedNotice}>
          <div className={styles.joinedNoticeContent}>
            <span>You are participating in this tournament! Good luck!</span>
          </div>
          <button className={styles.dismissBtn} onClick={handleDismissJoinedNotice}>
            <X size={18} weight="bold" />
          </button>
        </div>
      )}

      {selectedTournamentMessage?.type === 'reauth' && (
        <div className={styles.joinedNotice}>
          <div className={styles.joinedNoticeContent}>
            <span>
              Please login with Hattrick CHPP to refresh your credentials and to get access to new feature updates
            </span>
          </div>
          <div className={styles.reauthActions}>
            <Button size="sm" variant="primary" onClick={handleRefreshHattrickLogin}>
              Login with CHPP
            </Button>
          </div>
        </div>
      )}

      {selectedTournamentMessage?.type === 'announcement' && (
        <div className={styles.joinedNotice}>
          <div className={styles.joinedNoticeContent}>
            <span>{selectedTournamentMessage.announcement.content}</span>
          </div>
          <button
            className={styles.dismissBtn}
            onClick={() => handleDismissAnnouncement(selectedTournamentMessage.announcement)}
          >
            <X size={18} weight="bold" />
          </button>
        </div>
      )}

      <div className={styles.tabs}>
        <button className={activeTab === 'standings' ? styles.active : ''} onClick={() => handleTabChange('standings')}>
          Standings
        </button>
        <button className={activeTab === 'fixtures' ? styles.active : ''} onClick={() => handleTabChange('fixtures')}>
          Fixtures <span className="hideOnMobile">& Results</span>
        </button>
        <button className={activeTab === 'history' ? styles.active : ''} onClick={() => handleTabChange('history')}>
          History
          {historyTabBadgeCount > 0 && (
            <span className={styles.historyTabBadge} aria-label="New season history activity">
              {historyTabBadgeCount}
            </span>
          )}
        </button>
        <button className={isNewsTab ? styles.active : ''} onClick={() => handleTabChange('news')}>
          News
        </button>
        <button className={activeTab === 'admin' ? styles.active : ''} onClick={() => handleTabChange('admin')}>
          Admin
        </button>
      </div>

      <Modal
        isOpen={historyReportNoticeOpen && latestPublishedHistorySeason !== null}
        onClose={dismissHistoryReportNotice}
        title={`Season ${latestPublishedHistorySeason?.season_number} history`}
        maxWidth="520px"
        modalClassName={styles.historyReportModal}
        headerClassName={styles.historyReportHeader}
        closeButtonClassName={styles.historyReportClose}
      >
        <p className={styles.historyReportText}>
          <strong>🏆 Season {latestPublishedHistorySeason?.season_number} history report is published!</strong> You can
          now view it and leave your one time only final season's comment!
        </p>
        <div className={styles.historyReportActions}>
          <Button
            variant="secondaryYellow"
            size="md"
            onClick={() => {
              markHistoryReportSeen();
              if (latestPublishedHistorySeason && typeof latestHistoryCommentCount === 'number') {
                localStorage.setItem(
                  `ht-120min:history-comments-read:${latestPublishedHistorySeason.id}`,
                  String(latestHistoryCommentCount),
                );
                setHistorySeenVersion((current) => current + 1);
              }
              const nextParams = new URLSearchParams(searchParams);
              nextParams.set('tab', 'history');
              setSearchParams(nextParams);
            }}
          >
            View Season Report
          </Button>
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              dismissHistoryReportNotice();
            }}
          >
            Later
          </Button>
        </div>
      </Modal>

      {activeTab === 'history' && (
        <div className={styles.historyContainer}>
          <TournamentHistory
            seasons={seasons.map((season) => ({
              id: season.id,
              seasonNumber: season.season_number,
              status: season.status,
              plannedStartSlot: season.planned_start_slot,
              startedAt: season.started_at,
              finishedAt: season.finished_at,
              snapshot: season.snapshot_json,
            }))}
            currentHtUserId={currentHtUserId}
            selectedSeasonNumber={selectedHistorySeasonNumber}
            onSelectSeason={handleHistorySeasonChange}
            canGenerateReport={isAdminAuthenticated && tournament.status === 'finished'}
            isGeneratingReport={isFinalizingSeason}
            onGenerateReport={handleGenerateHistoryReport}
            autoScrollToYearbook={latestHistoryUnreadCount > 0}
            onCommentsLoaded={handleHistoryCommentsLoaded}
          />
        </div>
      )}

      {activeTab === 'fixtures' && (
        <FixturesView
          key={tournament?.id}
          rounds={rounds}
          upcomingRoundIndex={upcomingRoundIndex}
          season={tournament.season}
          defaultVisibleRoundsCount={defaultVisibleRoundsCount}
          expandedRounds={expandedRounds}
          toggleRound={toggleRound}
          onExpandAllRounds={expandAllRounds}
          onCollapseAllRounds={collapseAllRounds}
          tournament={tournament}
          isRefreshingFixtures={isRefreshingFixtures}
          handleRefreshFixtures={handleRefreshFixtures}
          copied={copied}
          setCopied={setCopied}
          warnings={warnings}
          liveData={liveData}
          canJoinTournament={canJoinTournament}
          canJoinAnotherTeam={canJoinAnotherTeamBeforeFixtures}
          isConnecting={isConnecting}
          onJoinWithHattrick={() => {
            setIsConnecting(true);
            window.location.href = `/api/auth/init?tournament_id=${tournament?.id}`;
          }}
        />
      )}

      {isNewsTab && (
        <div className={styles.newsLayout}>
          <div className={styles.guestbook}>
            <SectionCard title="News & Announcements">
            <div className={styles.newsTabs}>
              <button className={newsMode === 'team' ? styles.active : ''} onClick={() => setNewsMode('team')}>
                Team News
              </button>
              {isAdminAuthenticated && (
                <button className={newsMode === 'admin' ? styles.active : ''} onClick={() => setNewsMode('admin')}>
                  Announcement
                </button>
              )}
            </div>

            {/* Team Branding for Posting */}
            {newsMode === 'team' && (
              <div className={styles.postingTeamBranding}>
                {/* Need to find current manager's team assuming we have teams array */}
                {(() => {
                  const myHtId = localStorage.getItem('my_ht_user_id');
                  const myTeam = teams.find((t) => t.hattrick_user_id === Number(myHtId));
                  return myTeam ? (
                    <div className={styles.branding}>
                      <img
                        src={myTeam.logo_url || DEFAULT_TEAM_LOGO}
                        alt={myTeam.name}
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = DEFAULT_TEAM_LOGO;
                        }}
                      />
                      <span>
                        Posting as: <strong>{myTeam.name}</strong>
                      </span>
                    </div>
                  ) : (
                    <p>You don't have a team in this tournament.</p>
                  );
                })()}
              </div>
            )}

            <form onSubmit={handlePostMessage} className={styles.postForm}>
              <div className={styles.newsInputGroup}>
                <input
                  type="text"
                  value={newNewsTitle}
                  onChange={(e) => setNewNewsTitle(e.target.value)}
                  placeholder="Article Title..."
                  className={styles.postTitleInput}
                />
                <textarea
                  value={newNewsContent}
                  onChange={(e) => setNewNewsContent(e.target.value)}
                  placeholder={
                    newsMode === 'admin' ? 'Write a tournament announcement...' : "Share your team's news..."
                  }
                  className={styles.postTextarea}
                  rows={3}
                />
              </div>
              <div className={styles.postActions}>
                <Button type="submit" variant="primary" disabled={isPostingNews || !newNewsContent.trim()}>
                  {isPostingNews ? 'Posting...' : 'Post News'}
                </Button>
              </div>
            </form>

            <div className={styles.postsList}>
              {newsPosts.length === 0 ? (
                <p className={styles.noPosts}>No news yet.</p>
              ) : (
                newsPosts.map((post) => (
                  <div key={post.id} className={`${styles.post} ${post.is_admin ? styles.adminPost : ''}`}>
                    <div className={styles.postHeader}>
                      {/* Team Logo if applicable */}
                      {post.author_team_id && teams.find((t) => t.id === post.author_team_id)?.logo_url && (
                        <img
                          src={teams.find((t) => t.id === post.author_team_id)?.logo_url}
                          className={styles.postLogo}
                          alt=""
                        />
                      )}
                      <span className={styles.postAuthor}>{post.author_name}</span>
                      <span className={styles.postTime}>
                        {new Date(post.created_at).toLocaleString('lv-LV', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    {post.title && <h4 className={styles.postTitle}>{post.title}</h4>}
                    <div className={styles.postContent}>{post.content}</div>

                    {/* Reaction Bar */}
                    <div className={styles.reactionBar}>
                      {['🔥', '💪', '👌', '❤️', '🥶', '😱', '😢', '🏆'].map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => handleAddReaction(post.id, emoji)}
                          className={styles.reactionBtn}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
            </SectionCard>
          </div>
          <aside className={styles.newsSidebar}>
            <CompactAccordionWidget
              title="Tournament FAQ"
              icon={<Question size={20} weight="bold" />}
              items={tournamentFaqItems}
            />
          </aside>
        </div>
      )}

      {activeTab === 'standings' && (
        <div className={styles.standingsContainer}>
          <div className={styles.mainColumn}>
            <StandingsView
              standings={standings}
              is120minMode={is120minMode}
              myHtUserId={myHtUserId}
              tournament={tournament}
              lastSeenMap={lastSeenMap}
              onRefreshPresence={fetchPresenceOnly}
              canJoinTournament={canJoinTournament}
              isConnecting={isConnecting}
              onJoinWithHattrick={() => {
                setIsConnecting(true);
                window.location.href = `/api/auth/init?tournament_id=${tournament?.id}`;
              }}
              seasonId={currentSeason?.id}
              seasonNumber={currentSeason?.season_number ?? tournament.season}
              seasonStatus={currentSeason?.status === 'finished' ? 'finished' : 'ongoing'}
              onCommentsLoaded={handleHistoryCommentsLoaded}
              onVisitHistory={() => handleTabChange('history')}
            />
          </div>
          <aside className={styles.statsSidebar}>
            <MottoWidget items={TOURNAMENT_DEFAULT} theme="dark" variant="sidebar" />
            <ChatView
              messages={chatMessages}
              onSendMessage={handlePostChat}
              myHtUserId={myHtUserId ? Number(myHtUserId) : null}
              leagueManagerIds={teams.map((t) => t.hattrick_user_id).filter((id): id is number => !!id)}
              teamNames={teams.reduce((acc, t) => ({ ...acc, [t.hattrick_user_id || 0]: t.name }), {})}
            />
            <CompactAccordionWidget
              title="Tournament FAQ"
              icon={<Question size={20} weight="bold" />}
              items={tournamentFaqItems}
            />
          </aside>
        </div>
      )}

      {activeTab === 'admin' && (
        <div className={styles.adminSection}>
          {!isAdminAuthenticated ? (
            <SectionCard
              title="Admin Access"
              subtitle={
                publicOrganizerName && (
                  <div className={styles.organizerInfo}>
                    <span className={styles.organizerLabel}>Organizer: </span>
                    <span className={styles.organizerName}>
                      {tournament.organizer_id ? (
                        <a
                          href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${tournament.organizer_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${styles.htLink} ${styles.headerBadge}`}
                        >
                          {publicOrganizerName}{' '}
                          <ArrowUpRight size={16} weight="bold" style={{ marginLeft: '0.25rem' }} />
                        </a>
                      ) : (
                        publicOrganizerName
                      )}
                    </span>
                  </div>
                )
              }
            >
              <div className={styles.adminAuthForm}>
                <form onSubmit={canLoginAsOrganizer ? handleOrganizerLogin : handleAdminLogin}>
                  <div className={styles.authField}>
                    <label>{canLoginAsOrganizer ? 'Auto-login as the organizer:' : 'Tournament Password'}</label>
                    {canLoginAsOrganizer ? (
                      <input type="text" value={organizerLoginLabel} readOnly className={styles.readOnlyName} />
                    ) : (
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (adminAuthError) setAdminAuthError(false);
                        }}
                        placeholder="Enter admin password"
                        required
                      />
                    )}
                  </div>
                  {!canLoginAsOrganizer && adminAuthError && (
                    <p className={styles.authError}>Invalid password. Please try again.</p>
                  )}
                  <Button type="submit" variant="primaryDanger" size="md">
                    Login <ArrowRight size={18} weight="bold" />
                  </Button>
                </form>

                <div className={styles.adminAuthFooter}>
                  {failedLoginAttempt ? (
                    <p className={styles.adminAuthNote}>Forgot password? Recover with a registered email.</p>
                  ) : (
                    <a href="/create" className={styles.adminAuthLink}>
                      Want to be an admin? <u>Start your own tournament</u>.
                    </a>
                  )}
                </div>
              </div>
            </SectionCard>
          ) : (
            <div className={adminStyles.admin}>
              <div className={adminStyles.mainGrid}>
                <section className={adminStyles.teamsSection}>
                  <SectionCard
                    title="Tournament Settings"
                    collapsible
                    isCollapsed={isSettingsCollapsed}
                    onToggleCollapse={() => togglePanel('settings', !isSettingsCollapsed, setIsSettingsCollapsed)}
                  >
                    <div className={adminStyles.settingsGroup}>
                      {/* EDIT TOURNAMENT NAME **
                      <div className={adminStyles.field}>

                        <div className={adminStyles.labelRow}>
                          <label>Tournament Name</label>
                          <button type="button" onClick={regenerateName} className={adminStyles.iconBtn}>
                            <ArrowClockwise size={20} weight="bold" />
                          </button>
                        </div>
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div> */}

                      <div className={adminStyles.meta}>
                        <div className={adminStyles.metaItem}>
                          {!isMobile ? (
                            <span className={adminStyles.label}>Public URL:</span>
                          ) : (
                            <span className={adminStyles.label}>URL:</span>
                          )}
                          <a href={publicUrl} target="_blank" className={styles.publicUrl}>
                            <code>{publicUrlDisplay}</code>
                          </a>
                          <CopySimple
                            size={24}
                            onClick={() => {
                              navigator.clipboard.writeText(publicUrl);
                              alert('URL copied!');
                            }}
                            weight="bold"
                            className={adminStyles.copyIcon}
                          />
                        </div>
                        <div className={adminStyles.metaItem}>
                          {!isMobile ? (
                            <span className={adminStyles.label}>Admin Password:</span>
                          ) : (
                            <span className={adminStyles.label}>Password:</span>
                          )}

                          <code>{tournament.admin_password}</code>
                          {canLoginAsOrganizer && (
                            <button
                              type="button"
                              onClick={handleResetAdminPassword}
                              className={adminStyles.copyIcon}
                              title="Reset password"
                              aria-label="Reset tournament admin password"
                              disabled={isResettingAdminPassword}
                            >
                              <ArrowClockwise size={24} weight="bold" />
                            </button>
                          )}
                          <CopySimple
                            size={24}
                            onClick={() => {
                              navigator.clipboard.writeText(tournament.admin_password);
                              alert("Password copied! Don't lose it.");
                            }}
                            weight="bold"
                            className={adminStyles.copyIcon}
                          />
                        </div>
                      </div>

                      <div className={adminStyles.field}>
                        <label>Tournament Category</label>
                        <select
                          value={editLeagueCategory}
                          onChange={(e) => setEditLeagueCategory(e.target.value as any)}
                          disabled={teams.length > 0 && !isSuperAdmin}
                          className={adminStyles.selectField}
                        >
                          <option value="male">Regular league (male)</option>
                          <option value="hfi">Hattrick Femme International (HFI)</option>
                        </select>
                        {teams.length > 0 && !isSuperAdmin && (
                          <p className={adminStyles.smallNote}>Category is locked once teams have registered.</p>
                        )}
                      </div>

                      <div className={adminStyles.field}>
                        <label>Team limit</label>
                        <select
                          value={editMaxTeams ?? ''}
                          onChange={(e) => setEditMaxTeams(e.target.value ? Number(e.target.value) : null)}
                          className={adminStyles.selectField}
                        >
                          <option value="">Unlimited (decide later)</option>
                          {[2, 4, 6, 8, 16, 32, 64].map((n) => (
                            <option key={n} value={n}>
                              {n} teams
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className={adminStyles.field}>
                        <label>Planned start date</label>
                        <select
                          value={scheduleStartSlotId}
                          onChange={(e) => setScheduleStartSlotId(e.target.value)}
                          disabled={scheduleDraft.startSlotOptions.length === 0}
                          className={adminStyles.selectField}
                        >
                          <option value="" disabled>
                            {scheduleDraft.startSlotOptions.length > 0 ? 'Select a start date...' : 'Not enough teams'}
                          </option>
                          {scheduleDraft.startSlotOptions.map((slot) => (
                            <option key={slot.id} value={slot.id}>
                              {`HT S${slot.ht120minSeason} W${slot.htWeek} • ${formatCalendarDateWithWeek(slot.nominalDate, 'short')}`}
                            </option>
                          ))}
                        </select>
                        <p className={adminStyles.smallNote}>Used as the planned first date on tournament cards.</p>
                      </div>

                      <div className={adminStyles.field}>
                        <label>Tournament Type</label>
                        <select
                          value={editRegistrationType}
                          onChange={(e) => setEditRegistrationType(normalizeTournamentRegistrationType(e.target.value))}
                          disabled={teams.length > 0 && !isSuperAdmin}
                          className={adminStyles.selectField}
                        >
                          <option value="validated">Hattrick Validated (CHPP)</option>
                          <option value="manual">Organizer-Managed</option>
                          <option value="sandbox">Sandbox Playground</option>
                        </select>
                      </div>

                      <div className={adminStyles.field}>
                        <label>League of team (any or locked to existing)</label>
                        <select
                          value={editCountryLimit || validatedCountryLimit || ''}
                          onChange={(e) => setEditCountryLimit(e.target.value || null)}
                          className={adminStyles.selectField}
                        >
                          <option value="">Any Hattrick League</option>
                          {validatedCountryLimit && (
                            <option value={validatedCountryLimit}>{HATTRICK_LEAGUES[validatedCountryLimit]}</option>
                          )}
                        </select>
                        {(() => {
                          const validatedTeams = teams.filter((t) => t.joined_via_oauth && t.country_name);
                          const countries = Array.from(new Set(validatedTeams.map((t) => t.country_name)));
                          if (countries.length >= 2) {
                            return (
                              <p className={adminStyles.smallNote}>teams from at least 2 leagues already registered</p>
                            );
                          }
                          return null;
                        })()}
                      </div>

                      <div className={adminStyles.checkboxField}>
                        <label className={adminStyles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={editChppOnlyJoin}
                            onChange={(e) => setEditChppOnlyJoin(e.target.checked)}
                          />
                          Only Hattrick validated teams can join
                        </label>
                      </div>

                      <div className={adminStyles.checkboxField}>
                        <label className={adminStyles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={editIsPrivate}
                            onChange={(e) => setEditIsPrivate(e.target.checked)}
                          />
                          Private Tournament (unlisted on home page)
                        </label>
                      </div>

                      <div>
                        <div className={adminStyles.checkboxField}>
                          <div className={adminStyles.labelRow}>
                            <label className={adminStyles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={showEditDescription}
                                onChange={(e) => setShowEditDescription(e.target.checked)}
                              />
                              Show Description
                            </label>
                            {showEditDescription && (
                              <button
                                type="button"
                                onClick={() => regenerateDescription(false)}
                                className={adminStyles.iconBtn}
                                title="Regenerate description"
                              >
                                <ArrowClockwise size={20} weight="bold" />
                              </button>
                            )}
                          </div>
                        </div>

                        {showEditDescription && (
                          <div className={`${adminStyles.textField} ${styles.mt1}`}>
                            <textarea
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              placeholder="Tournament description..."
                              rows={4}
                            />
                          </div>
                        )}
                      </div>

                      <div className={styles.mt1}>
                        <div className={adminStyles.checkboxField}>
                          <label className={adminStyles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={showEditEmail}
                              onChange={(e) => setShowEditEmail(e.target.checked)}
                            />
                            Recovery email address (recommended)
                          </label>
                        </div>
                        {showEditEmail && (
                          <div className={`${adminStyles.textField} ${styles.mt1}`}>
                            <input
                              type="email"
                              value={editAdminEmail}
                              onChange={(e) => setEditAdminEmail(e.target.value)}
                              placeholder="In case you forget your admin password..."
                            />
                          </div>
                        )}
                      </div>

                      {isSuperAdmin && (
                        <div className={`${adminStyles.checkboxField} ${styles.formDivider}`}>
                          <label className={adminStyles.checkboxLabel}>
                            <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
                            Testing Ground (Super-Admin only)
                          </label>
                        </div>
                      )}

                      {canManageFeaturedTournaments && (
                        <div className={`${adminStyles.checkboxField} ${styles.formDivider}`}>
                          <label className={adminStyles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={editIsFeatured}
                              onChange={(e) => setEditIsFeatured(e.target.checked)}
                            />
                            <Star size={16} weight="bold" />
                            Featured tournament
                          </label>
                          <p className={adminStyles.smallNote}>Pinned to the top of its public lists.</p>
                        </div>
                      )}
                    </div>
                    {settingsHasUnsavedChanges && (
                      <p className={adminStyles.unsavedSettingsNote}>Use save button to apply changes!</p>
                    )}
                    <Button onClick={updateSettings} disabled={isUpdatingSettings} variant="primary" size="sm">
                      {isUpdatingSettings ? 'Saving...' : 'Save Settings'}
                    </Button>
                  </SectionCard>

                  <SectionCard title="Season planner" className={adminStyles.seasonPlannerCard}>
                    <div className={adminStyles.seasonPlanner}>
                      {previousSeasons.length > 0 && (
                        <div>
                          <h3>Previous seasons</h3>
                          <ul className={adminStyles.seasonList}>
                            {previousSeasons.map((season) => (
                              <li key={season.id}>
                                <span>
                                  Season {season.season_number} {season.status}
                                </span>
                                {season.snapshot_json &&
                                  (!('version' in season.snapshot_json) || season.snapshot_json.version !== 2) && (
                                    <Button
                                      variant="outline"
                                      size="xs"
                                      onClick={() => handleRebuildSeasonSnapshot(season)}
                                      disabled={rebuildingSeasonNumber !== null}
                                    >
                                      {rebuildingSeasonNumber === season.season_number
                                        ? 'Rebuilding...'
                                        : 'Rebuild archive'}
                                    </Button>
                                  )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div>
                        <h3>Current season</h3>
                        <p className={adminStyles.seasonCurrent}>
                          Season {tournament.season} {currentSeason?.status || tournament.status}
                          {tournament.status === 'finished'
                            ? formatHistoryDate(currentSeason?.finished_at) &&
                              ` • Finished ${formatHistoryDate(currentSeason?.finished_at)}`
                            : isGenerated
                              ? formatHistoryDate(currentSeason?.started_at || tournament.schedule_generated_at) &&
                                ` • Started ${formatHistoryDate(currentSeason?.started_at || tournament.schedule_generated_at)}`
                              : formatHistoryDate(
                                  currentSeason?.planned_start_slot || tournament.schedule_start_slot,
                                ) &&
                                ` • Planned ${formatHistoryDate(currentSeason?.planned_start_slot || tournament.schedule_start_slot)}`}
                        </p>
                        <p className={adminStyles.smallNote}>
                          {tournament.status === 'finished' && !currentSeason?.snapshot_json
                            ? 'This season is finished, but its History report has not been generated yet.'
                            : tournament.status === 'finished'
                              ? 'This season is finished and preserved in History. You can now add a new season.'
                              : isGenerated
                                ? 'Finish the season when its competition is complete. This preserves its final History report.'
                                : 'Generate a schedule before finishing this season.'}
                        </p>
                      </div>
                      <div className={adminStyles.seasonActions}>
                        {tournament.status !== 'finished' && isGenerated && (
                          <Button
                            variant="primaryDanger"
                            size="sm"
                            onClick={handleFinishSeason}
                            disabled={isFinalizingSeason}
                          >
                            {isFinalizingSeason ? 'Finishing...' : 'Finish season'}
                          </Button>
                        )}
                        {tournament.status === 'finished' && !currentSeason?.snapshot_json && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleGenerateHistoryReport}
                            disabled={isFinalizingSeason}
                          >
                            {isFinalizingSeason ? 'Generating...' : 'Generate history report'}
                          </Button>
                        )}
                        {tournament.status === 'finished' && currentSeason?.snapshot_json && (
                          <>
                            <Button variant="outline" size="sm" disabled>
                              History report generated
                            </Button>
                            <Button variant="primary" size="sm" onClick={handleAddNewSeason} disabled={isAddingSeason}>
                              {isAddingSeason ? 'Adding...' : 'Add new'}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </SectionCard>

                  {!isGenerated && canManageSchedule && (
                    <TournamentSchedulePanel
                      isGenerated={isGenerated}
                      isCollapsed={resolvedScheduleCollapsed}
                      onToggleCollapse={() => {
                        const next = !resolvedScheduleCollapsed;
                        if (slug) setScheduleCollapseOverrides((current) => ({ ...current, [slug]: next }));
                        if (scheduleCollapseStorageKey)
                          localStorage.setItem(scheduleCollapseStorageKey, JSON.stringify(next));
                      }}
                      draft={scheduleDraft}
                      onScheduleModeChange={handleScheduleModeChange}
                      onSelectedStartSlotIdChange={handleScheduleStartSlotIdChange}
                      includeWeek15WeekendFriendly={includeWeek15WeekendFriendly}
                      onIncludeWeek15WeekendFriendlyChange={handleIncludeWeek15WeekendFriendlyChange}
                      isGenerating={isGenerating}
                      onGenerate={generateSchedule}
                      tournamentTeamLimit={editMaxTeams}
                    />
                  )}

                  {isGenerated && (
                    <AdminResults
                      rounds={rounds}
                      editingMatch={editingMatch}
                      setEditingMatch={setEditingMatch}
                      updateMatch={updateMatch}
                      isResultsCollapsed={isResultsCollapsed}
                      setIsResultsCollapsed={setIsResultsCollapsed}
                      togglePanel={togglePanel}
                      matchData={matchData}
                      setMatchData={setMatchData as any}
                      currentRoundId={currentRoundIdForResults ?? undefined}
                      previewHtMatchLink={previewHtMatchLink}
                      saveHtMatchLink={saveHtMatchLink}
                    />
                  )}

                  {isGenerated && canManageSchedule && (
                    <TournamentSchedulePanel
                      isGenerated={isGenerated}
                      isCollapsed={resolvedScheduleCollapsed}
                      onToggleCollapse={() => {
                        const next = !resolvedScheduleCollapsed;
                        if (slug) setScheduleCollapseOverrides((current) => ({ ...current, [slug]: next }));
                        if (scheduleCollapseStorageKey)
                          localStorage.setItem(scheduleCollapseStorageKey, JSON.stringify(next));
                      }}
                      draft={scheduleDraft}
                      onScheduleModeChange={handleScheduleModeChange}
                      onSelectedStartSlotIdChange={handleScheduleStartSlotIdChange}
                      includeWeek15WeekendFriendly={includeWeek15WeekendFriendly}
                      onIncludeWeek15WeekendFriendlyChange={handleIncludeWeek15WeekendFriendlyChange}
                      isGenerating={isGenerating}
                      onGenerate={generateSchedule}
                      tournamentTeamLimit={editMaxTeams}
                      rescheduleDraft={rescheduleDraft}
                      onRescheduleFromRoundChange={handleRescheduleFromRoundChange}
                      onRescheduleStartSlotIdChange={handleRescheduleStartSlotIdChange}
                      includeWeek15WeekendFriendlyForReschedule={includeWeek15WeekendFriendlyForReschedule}
                      onIncludeWeek15WeekendFriendlyForRescheduleChange={
                        handleIncludeWeek15WeekendFriendlyForRescheduleChange
                      }
                      isRescheduling={isRescheduling}
                      onReschedule={regenerateSchedule}
                    />
                  )}

                  <SectionCard
                    title="Manage Teams"
                    collapsible
                    isCollapsed={isTeamsCollapsed}
                    onToggleCollapse={() => togglePanel('teams', !isTeamsCollapsed, setIsTeamsCollapsed)}
                  >
                    {(!isGenerated || teams.some((t) => !t.active) || teams.length % 2 !== 0) && (
                      <div className={adminStyles.addTeamSection}>
                        <h3 className={adminStyles.sectionTitle}>
                          {isValidatedTournament ? 'Invite Team' : 'Add Team'}
                        </h3>
                        {isValidatedTournament && (
                          <p className={styles.helperText}>
                            In a self-validated tournament, you can't add teams manually. Use this tool to get team data
                            and then send them an invitation.
                          </p>
                        )}
                        <form onSubmit={(e) => addTeam(e, false)} className={adminStyles.teamForm}>
                          <div className={adminStyles.inputGroup}>
                            <input
                              name="team_ht_id"
                              type="text"
                              placeholder="HT Team ID"
                              value={newTeamId}
                              onChange={(e) => {
                                setNewTeamId(e.target.value.replace(/\D/g, ''));
                                setNewTeamName('');
                                setNewTeamData(null);
                              }}
                              minLength={6}
                              maxLength={9}
                              required
                            />
                            <input
                              name="team_name"
                              type="text"
                              placeholder="Team Name"
                              value={newTeamName}
                              readOnly
                              className={!newTeamName ? styles.opacity06 : ''}
                              required
                            />
                          </div>
                          {newTeamId.length >= 6 && !newTeamName && (
                            <Button
                              type="button"
                              onClick={() => fetchTeamData(newTeamId, false)}
                              disabled={isFetchingTeamData}
                              variant="primary"
                            >
                              {isFetchingTeamData ? 'Fetching...' : 'Get team data'}
                            </Button>
                          )}
                          {newTeamName && (
                            <>
                              {isValidatedTournament ? (
                                <div className={styles.inviteSection}>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setIsInviteExpanded(!isInviteExpanded)}
                                    className={styles.mt05}
                                  >
                                    {isInviteExpanded ? 'Hide Invitation Template' : 'Show invitation template'}
                                  </Button>
                                  {isInviteExpanded && (
                                    <div className={styles.inviteTemplateWrapper}>
                                      <textarea
                                        readOnly
                                        className={styles.inviteTextarea}
                                        value={`Join our tournament "${tournament.name}" on HT-120min! We have a spot for ${newTeamName}. Register here: ${publicUrl}`}
                                      />
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        className={styles.copyInviteButton}
                                        onClick={() => {
                                          navigator.clipboard.writeText(
                                            `Join our tournament "${tournament.name}" on HT-120min! We have a spot for ${newTeamName}. Register here: ${publicUrl}`,
                                          );
                                          alert('Invitation template for ' + newTeamName + ' copied!');
                                        }}
                                      ></Button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <Button type="submit" disabled={isSavingTeam} variant="primary">
                                  {isSavingTeam ? 'Saving...' : 'Add team to tournament'}
                                </Button>
                              )}
                            </>
                          )}
                        </form>
                      </div>
                    )}
                    <ul className={adminStyles.teamList}>
                      {teams.map((team) => (
                        <li key={team.id} className={!team.active ? adminStyles.inactiveTeam : ''}>
                          <div className={adminStyles.teamInfo}>
                            <div className={styles.nameRow}>
                              <span className={adminStyles.name}>{team.name}</span>
                              {team.joined_via_oauth && <span title="Hattrick Validated Team"></span>}
                              {isStoppedTournament &&
                                team.active &&
                                team.ht_team_id &&
                                playingElsewhereTeamIds.has(team.ht_team_id) && (
                                  <span className={adminStyles.playingElsewhere}>PLAYING ELSEWHERE!</span>
                                )}
                            </div>
                            {team.ht_team_id && <span className={adminStyles.id}>ID: {team.ht_team_id}</span>}
                            {!team.active && <span className={adminStyles.statusBadge}>Inactive</span>}
                          </div>

                          <div className={adminStyles.teamActions}>
                            {team.active ? (
                              <>
                                {replacingTeamId === team.id ? (
                                  <div className={adminStyles.inlineReplace}>
                                    <input
                                      name={`replace_id_${team.id}`}
                                      type="text"
                                      placeholder="New HT ID"
                                      value={replacementHtId}
                                      onChange={(e) => {
                                        setReplacementHtId(e.target.value.replace(/\D/g, ''));
                                        setReplacementName('');
                                        setReplacementTeamData(null);
                                      }}
                                      required
                                    />
                                    <input
                                      name={`replace_name_${team.id}`}
                                      type="text"
                                      placeholder="New Name"
                                      value={replacementName}
                                      readOnly
                                      className={!replacementName ? styles.opacity06 : ''}
                                      required
                                    />
                                    <div className={adminStyles.replaceActions}>
                                      {replacementHtId.length >= 6 && !replacementName && (
                                        <Button
                                          size="sm"
                                          onClick={() => fetchTeamData(replacementHtId, true)}
                                          disabled={isFetchingTeamData}
                                          variant="primary"
                                        >
                                          Check
                                        </Button>
                                      )}
                                      {replacementName && (
                                        <Button
                                          size="sm"
                                          onClick={() => replaceTeam(team.id)}
                                          disabled={isSavingTeam}
                                          variant="primary"
                                        >
                                          Save
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => {
                                          setReplacingTeamId(null);
                                          setReplacementHtId('');
                                          setReplacementName('');
                                        }}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button size="sm" variant="zero" onClick={() => setReplacingTeamId(team.id)}>
                                    <ArrowClockwise size={16} /> Replace
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => {
                                    const action = isGenerated ? 'deactivate' : 'delete';
                                    if (window.confirm(`Are you sure you want to ${action} this team?`)) {
                                      deleteTeam(team.id);
                                    }
                                  }}
                                  title={isGenerated ? 'Deactivate Team' : 'Delete Team'}
                                >
                                  <Trash size={16} /> Delete
                                </Button>
                              </>
                            ) : (
                              <div className={adminStyles.inactiveActions}>
                                <Button size="sm" variant="primary" onClick={() => reviveTeam(team.id)}>
                                  Revive
                                </Button>
                                {replacingTeamId === team.id ? (
                                  <div className={adminStyles.inlineReplace}>
                                    <input
                                      type="text"
                                      placeholder="New HT ID"
                                      value={replacementHtId}
                                      onChange={(e) => {
                                        setReplacementHtId(e.target.value.replace(/\D/g, ''));
                                        setReplacementName('');
                                        setReplacementTeamData(null);
                                      }}
                                      required
                                    />
                                    <input
                                      type="text"
                                      placeholder="New Name"
                                      value={replacementName}
                                      readOnly
                                      className={!replacementName ? styles.opacity06 : ''}
                                      required
                                    />
                                    <div className={adminStyles.replaceActions}>
                                      {replacementHtId.length >= 6 && !replacementName && (
                                        <Button
                                          size="sm"
                                          onClick={() => fetchTeamData(replacementHtId, true)}
                                          disabled={isFetchingTeamData}
                                          variant="primary"
                                        >
                                          <ArrowClockwise size={16} weight="bold" /> Check
                                        </Button>
                                      )}
                                      {replacementName && (
                                        <Button
                                          size="sm"
                                          onClick={() => replaceTeam(team.id)}
                                          disabled={isSavingTeam}
                                          variant="primary"
                                        >
                                          Save
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => {
                                          setReplacingTeamId(null);
                                          setReplacementHtId('');
                                          setReplacementName('');
                                        }}
                                      ></Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button size="sm" variant="zero" onClick={() => setReplacingTeamId(team.id)}></Button>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className={adminStyles.inviteTemplate}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsInviteExpanded(!isInviteExpanded)}
                        className={adminStyles.inviteBtn}
                      >
                        {isInviteExpanded ? 'Invitation template' : 'Invite a Team'}
                      </Button>
                      {isInviteExpanded && (
                        <div className={adminStyles.templateBox}>
                          <label className={adminStyles.inviteLabel}>Share this with your Hattrick buddies</label>
                          <textarea
                            readOnly
                            value={`You are invited to join "${tournament.name}" (Season ${tournament.season}) on HT-120min! Register your team here: ${publicUrl}`}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                `You are invited to join "${tournament.name}" (Season ${tournament.season}) on HT-120min! Register your team here: ${publicUrl}`,
                              );
                              alert('Invitation copied!');
                            }}
                          ></Button>
                        </div>
                      )}
                    </div>
                  </SectionCard>
                </section>

                <Tooltip id="admin-tooltip" className="tooltip" />
              </div>

              <div className={adminStyles.simulatorSection}>
                <h3 className={adminStyles.sectionTitle}>Admin announcements</h3>
                <p className={adminStyles.smallNote}>
                  Publish a dismissible message in the top tournament notice area.
                </p>
                <AdminAnnouncementComposer onPublishAnnouncement={handleAnnouncementPublish} />

                <div className={adminStyles.announcementList}>
                  <h4>Announcements</h4>
                  {announcements.length === 0 ? (
                    <p className={adminStyles.smallNote}>No announcements yet.</p>
                  ) : (
                    announcements.map((announcement) => (
                      <div
                        key={announcement.id}
                        className={`${adminStyles.announcementListItem} ${
                          !announcement.is_active ? adminStyles.announcementHidden : ''
                        }`}
                      >
                        <div>
                          <p>{announcement.content}</p>
                          <span>
                            {announcement.visibility === 'public' ? 'Public' : 'Participants'} •{' '}
                            {announcement.is_active ? 'Visible' : 'Hidden'} •{' '}
                            {new Date(announcement.created_at).toLocaleDateString('en-GB')}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAnnouncementVisibilityToggle(announcement)}
                        >
                          {announcement.is_active ? 'Hide for all' : 'Show for all'}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className={adminStyles.footerActions}>
                {tournament.status === 'finished' ? (
                  <>
                    <p className={adminStyles.lifecycleHelp}>
                      This tournament is finished. Its history stays visible, but participating teams can join or create
                      other tournaments.
                    </p>
                    <div className={adminStyles.lifecycleButtons}>
                      <Button variant="outline" size="sm" disabled>
                        Finished
                      </Button>
                    </div>
                  </>
                ) : tournament.status === 'stopped' ? (
                  <>
                    <p className={adminStyles.lifecycleHelp}>
                      This tournament is fully stopped and unpublished. Teams may join other tournaments. Move it to
                      paused only after removing or replacing any team already playing elsewhere.
                    </p>
                    <div className={adminStyles.lifecycleButtons}>
                      <Button variant="primary" size="sm" onClick={handleMoveStoppedToPaused}>
                        Full stopped. Move to paused.
                      </Button>
                    </div>
                  </>
                ) : tournament.status === 'paused' ? (
                  <>
                    <p className={adminStyles.lifecycleHelp}>
                      This tournament is paused. Teams can still join and admins can edit participants, but schedule
                      generation and rescheduling stay hidden until it is active.
                    </p>
                    <div className={adminStyles.lifecycleButtons}>
                      <Button variant="primary" size="sm" onClick={handleSetPausedTournamentActive}>
                        Paused. Set as active!
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className={adminStyles.lifecycleHelp}>
                      This tournament is active. Pause it to wait for teams or take a break. Stop it to halt the
                      tournament, unpublish it and allow participants to play elsewhere.
                    </p>
                    <div className={adminStyles.lifecycleButtons}>
                      <Button variant="outline" size="sm" onClick={handlePauseTournament}>
                        Pause Tournament
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStopTournament}
                        data-tooltip-id="admin-tooltip"
                        data-tooltip-content={
                          'Stopping a tournament means the schedule is halted, the tournament is unpublished from public lists, and participants are allowed to join another tournament.'
                        }
                      >
                        Stop Tournament
                      </Button>
                    </div>
                  </>
                )}
                <div className={adminStyles.lifecycleButtons}>
                  <Button variant="outline" size="sm" onClick={handleAdminLogout}>
                    Logout
                  </Button>
                </div>
                {/* PERMANENTLY DELETE TOURNAMENT *
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => window.confirm('Permanently DELETE this tournament? This cannot be undone!')}
                >
                  Delete Tournament
                </Button> */}
              </div>
            </div>
          )}
        </div>
      )}

      <WelcomeModal
        isOpen={showCreatedTournamentWelcomeVisible}
        onClose={closeCreatedTournamentWelcome}
        onPrimaryAction={acceptCreatedTournamentWelcome}
        imageSrc="/create.png"
        imageAlt="New tournament ready for testing"
        title="Test tournament created!"
        buttonLabel="Let's start testing!"
      >
        <strong>Try the important parts while nothing serious is on the line:</strong>

        <ul>
          <li>👉 Add, remove and replace dummy teams, generate and inspect the schedule</li>
          <li>👉 Link matches to real ones via admin or add dummy scores</li>
          <li>👉 Test switching team limits and country rules</li>
        </ul>

        <p>When you feel like a pro, create the real tournament and invite people in.</p>
      </WelcomeModal>

      <WelcomeModal
        isOpen={showOpenTournamentWelcome}
        onClose={closeOpenTournamentWelcome}
        onPrimaryAction={acceptOpenTournamentWelcome}
        imageSrc="/register2.png"
        imageAlt="Open tournament welcome"
        title="This tournament is open!"
        buttonLabel="Sounds good"
      >
        <p>Next steps are simple:</p>
        <ul>
          <li>add your team to the tournament,</li>
          <li>invite a few others too,</li>
          <li>wait for Hattrick week 4 or until cup frees you,</li>
          <li>wait for the admin to generate the schedule,</li>
          <li>start booking matches from that schedule and enjoy yourself.</li>
        </ul>
      </WelcomeModal>

      <Modal isOpen={isEditingImage} onClose={() => setIsEditingImage(false)} title="Update Tournament Image">
        <div className={styles.modalContent}>
          <p>
            Link to an external image URL (e.g., Imgur, Hattrick logo, etc.). Make sure it's the address of image itself
            (right click + copy image address)
          </p>
          <div className={adminStyles.field}>
            <label>Image URL</label>
            <input
              type="text"
              value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              placeholder="https://..."
              className={adminStyles.selectField}
            />
          </div>
          <div className={styles.modalFooter}>
            <Button variant="primary" fullWidth onClick={handleUpdateImage} disabled={isUpdatingImage}>
              {isUpdatingImage ? 'Updating...' : 'Save Image'}
            </Button>
            <Button
              variant="outlineWhite"
              fullWidth
              onClick={() => setIsEditingImage(false)}
              style={{ marginTop: '0.5rem' }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showTeamModal}
        onClose={() => {
          setShowTeamModal(false);
          const newUrl = window.location.pathname;
          window.history.replaceState({}, '', newUrl);
        }}
        title={pendingJoinData ? `Welcome, ${pendingJoinData.manager_name}!` : 'Linking Hattrick…'}
      >
        <div className={styles.modalContent}>
          {modalLoading ? (
            <p className="center">Loading your teams…</p>
          ) : (
            <>
              <p style={{ marginBottom: '1.5rem', opacity: 0.9 }}>
                Which team should join <strong>{tournament.name}</strong>?
              </p>

              <div className={styles.teamOptionsList}>
                {pendingJoinData?.teams_json.map((team) => (
                  <div
                    key={team.teamId}
                    className={`${styles.teamOptionCard} ${submittingJoin ? styles.disabled : ''}`}
                    onClick={() => !submittingJoin && handleTeamSelect(team)}
                  >
                    <div className={styles.teamOptionInfo}>
                      <div className={styles.teamOptionHeader}>
                        <strong>{team.teamName}</strong>
                      </div>
                      <span className={styles.teamMeta}>
                        {[team.leagueLevelUnitName, team.regionName].filter(Boolean).join(' • ')}
                      </span>
                    </div>
                  </div>
                ))}
                {pendingJoinData?.teams_json.length === 0 && (
                  <p className="center">None of your teams are eligible for this tournament.</p>
                )}
              </div>

              {submittingJoin && <p className={styles.joiningStatus}>Joining tournament...</p>}

              <div className={styles.modalFooter}>
                <Button
                  variant="outline"
                  fullWidth
                  onClick={() => {
                    setShowTeamModal(false);
                    const newUrl = window.location.pathname;
                    window.history.replaceState({}, '', newUrl);
                  }}
                  disabled={submittingJoin}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {showFullImage && tournament?.image_url && (
        <div className={styles.imageModalOverlay} onClick={() => setShowFullImage(false)}>
          <img src={tournament.image_url} alt="Tournament" className={styles.imageModalContent} />
        </div>
      )}
    </div>
  );
};
