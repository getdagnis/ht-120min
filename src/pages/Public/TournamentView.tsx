/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

import adminStyles from './TournamentAdmin.module.sass';
import styles from './TournamentView.module.sass';
import { buildCalendarSlots } from '../../utils/hattrick-calendar';
import { getTournamentBackgroundStyle } from '../../utils/visuals';
import { calculateStandings } from '../../utils/standings';
import type { TeamStanding } from '../../utils/standings';
import { validateTeamEligibility } from '../../utils/team-eligibility';
import { HATTRICK_LEAGUES, getLeagueIdByName, normalizeLeagueLimit } from '../../utils/leagues';
import { useLiveMatches } from '../../hooks/useLiveMatches';
import { buildScheduleDraft, serializeScheduleDraftForRpc, type ScheduleMode } from '../../utils/schedule-draft';
import { buildRescheduleDraft, serializeRescheduleDraftForRpc } from '../../utils/reschedule-draft';
import { getMatchDateForRound as resolveMatchDateForRound } from '../../utils/match-schedule';
import {
  ANNOUNCEMENT_TEMPLATES,
  JOINED_NOTICE_KEY,
  selectTournamentMessage,
  type TournamentAnnouncement,
  type TournamentAnnouncementDismissal,
  type TournamentAnnouncementVisibility,
} from '../../utils/tournament-announcements';

import { Tooltip } from 'react-tooltip';
import { Button } from '../../components/Button/Button';
import { HeroCard } from '../../components/Card/HeroCard';
import { SectionCard } from '../../components/Card/SectionCard';
import { ChatView } from '../../components/TournamentTabs/ChatView';
import { FixturesView } from '../../components/TournamentTabs/FixturesView';
import { AdminResults } from '../../components/TournamentTabs/Admin/AdminResults';
import { TournamentSchedulePanel } from '../../components/TournamentTabs/Admin/TournamentSchedulePanel';
import { Modal } from '../../components/Modal/Modal';
import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
import { StandingsView } from '../../components/TournamentTabs/StandingsView';
import { TOURNAMENT_DEFAULT } from '../../constants/descriptions';
import { ArrowClockwise, ArrowRight, ArrowUpRight, CopySimple, Info, Trash, X } from 'phosphor-react';

interface ChppTeamOption {
  teamId: number;
  teamName: string;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryName?: string;
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
  manager_name?: string;
  is_placeholder?: boolean;
  hattrick_user_id?: number;
  league_level?: number | null;
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
  thumbnail_index?: number;
  chpp_only_join: boolean;
  league_type: string;
  country_limit: string | null;
  league_category: 'male' | 'hfi';
  registration_type: 'Hattrick Validated (CHPP)' | 'Organizer-Managed';
  include_week15_weekend_friendly: boolean;
  organizer_name?: string;
  organizer_id?: number;
  image_url?: string;
  season: number;
  is_test: boolean;
  status: 'open' | 'active' | 'finished' | 'waiting';
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
  matches: MatchWithTeams[];
}

export const TournamentView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [rounds, setRounds] = useState<RoundWithMatches[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [lastSeenMap, setLastSeenMap] = useState<Record<number, string | null>>({});

  // Sync activeTab with URL search param 'tab'
  const activeTabParam = searchParams.get('tab');
  const activeTab = ['standings', 'fixtures', 'guestbook', 'admin', 'news'].includes(activeTabParam || '')
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
  const [adminAnnouncementContent, setAdminAnnouncementContent] = useState('');
  const deferredAdminAnnouncementContent = useDeferredValue(adminAnnouncementContent);
  const [isPublicAnnouncement, setIsPublicAnnouncement] = useState(false);
  const [isPublishingAnnouncement, setIsPublishingAnnouncement] = useState(false);
  const [, setPublicAnnouncementDismissalVersion] = useState(0);

  // Chat states
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  // Admin states
  const [password, setPassword] = useState(localStorage.getItem(`admin_pw_${slug}`) || '');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState(false);
  const [failedLoginAttempt, setFailedLoginAttempt] = useState(false);
  const [selectedAnnouncementTemplate, setSelectedAnnouncementTemplate] = useState<string | null>(null);
  const paramsHandledRef = useRef(false);
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [isUpdatingImage, setIsUpdatingImage] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<Record<string, Partial<MatchWithTeams>>>({});
  const [replacingTeamId, setReplacingTeamId] = useState<string | null>(null);
  const [replacementHtId, setReplacementHtId] = useState('');
  const [replacementName, setReplacementName] = useState('');
  const [isFetchingTeamData, setIsFetchingTeamData] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('single');
  const [scheduleStartSlotId, setScheduleStartSlotId] = useState('');
  const [rescheduleFromRoundNumber, setRescheduleFromRoundNumber] = useState<number | null>(null);
  const [rescheduleStartSlotId, setRescheduleStartSlotId] = useState('');

  // Tournament settings states
  const [editName, setEditName] = useState('');
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [editChppOnlyJoin, setEditChppOnlyJoin] = useState(true);
  const [editLeagueType, setEditLeagueType] = useState('male');
  const [editLeagueCategory, setEditLeagueCategory] = useState<'male' | 'hfi'>('male');
  const [editRegistrationType, setEditRegistrationType] = useState<'Hattrick Validated (CHPP)' | 'Organizer-Managed'>(
    'Hattrick Validated (CHPP)',
  );
  const [editCountryLimit, setEditCountryLimit] = useState<string | null>(null);
  const [editMaxTeams, setEditMaxTeams] = useState<number | null>(null);
  const [showEditDescription, setShowEditDescription] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [showEditEmail, setShowEditEmail] = useState(false);
  const [editAdminEmail, setEditAdminEmail] = useState('');
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [isTest, setIsTest] = useState(false);
  const validatedCountryLimit = useMemo(() => {
    const validatedTeams = teams.filter((t) => t.joined_via_oauth && t.country_name);
    const countries = Array.from(new Set(validatedTeams.map((t) => t.country_name)));
    if (countries.length !== 1) return null;
    return getLeagueIdByName(countries[0]!) ?? null;
  }, [teams]);

  const isSuperAdmin =
    document.cookie
      .split('; ')
      .find((row) => row.startsWith('issuperadmin='))
      ?.split('=')[1] === 'you%20bet' ||
    document.cookie
      .split('; ')
      .find((row) => row.startsWith('issuperadmin='))
      ?.split('=')[1] === 'you bet';

  const currentHtUserId = Number(localStorage.getItem('my_ht_user_id') || '0') || null;
  const currentHtManagerName = localStorage.getItem('my_ht_manager_name') || tournament?.organizer_name || 'Admin';
  const canLoginAsOrganizer = Boolean(
    tournament?.organizer_id && currentHtUserId && Number(tournament.organizer_id) === currentHtUserId,
  );
  const organizerLoginLabel = `🤖 ${currentHtManagerName} (organizer)`;
  const selectedAnnouncement =
    ANNOUNCEMENT_TEMPLATES.find((template) => template.id === selectedAnnouncementTemplate) || null;
  const dismissedPublicAnnouncementIds = new Set(
    announcements
      .filter((announcement) => localStorage.getItem(`announcement_dismissed_${announcement.id}`) === 'true')
      .map((announcement) => announcement.id),
  );

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

  const toggleRound = (roundId: string) => {
    const newExpanded = { ...expandedRounds, [roundId]: !expandedRounds[roundId] };
    setExpandedRounds(newExpanded);
    localStorage.setItem(`expanded_rounds_${slug}`, JSON.stringify(newExpanded));
  };
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
  const { liveData, lastRefresh } = useLiveMatches(tournament?.id, allMatches, () => {
    // Note: fetchData is defined below but hoisted as a const,
    // we call it inside this effect/callback safely.
  });

  const isHealthQuotaMet = useCallback(() => {
    if (!teams.length) return true;
    const totalCount = teams.filter((t) => !t.is_placeholder).length;
    const inactiveCount = teams.filter((t) => !t.active && !t.is_placeholder).length;

    // Small tournaments (2-3 teams) are exempt as per prompt ("recurring friendlies")
    if (totalCount <= 3) return true;

    if (totalCount <= 5) return inactiveCount === 0;
    if (totalCount === 6) return inactiveCount <= 1;
    if (totalCount === 7) return inactiveCount === 0;

    return inactiveCount / totalCount <= 0.25;
  }, [teams]);

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
        now: new Date(),
      }),
    [activeScheduleTeams, scheduleMode, scheduleStartSlotId],
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
        now: new Date(),
      }),
    [activeScheduleTeams, rescheduleFromRoundNumber, rescheduleInputRounds, rescheduleStartSlotId],
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
        now: new Date(),
      });
      setScheduleMode(nextDraft.mode);
      setScheduleStartSlotId(nextDraft.selectedStartSlotId || '');
    },
    [activeScheduleTeams],
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

  const reconcileRescheduleSelection = useCallback(
    (nextFromRoundNumber: number | null, nextStartSlotId: string | null) => {
      const nextDraft = buildRescheduleDraft({
        teams: activeScheduleTeams,
        rounds: rescheduleInputRounds,
        fromRoundNumber: nextFromRoundNumber,
        startSlotId: nextStartSlotId,
        now: new Date(),
      });
      setRescheduleFromRoundNumber(nextDraft.selectedFromRoundNumber);
      setRescheduleStartSlotId(nextDraft.selectedStartSlotId || '');
    },
    [activeScheduleTeams, rescheduleInputRounds],
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
      localStorage.setItem('last_viewed_tournament_id', tournamentData.id);
      setEditName(tournamentData.name);
      setEditIsPrivate(tournamentData.is_private);
      setEditChppOnlyJoin(tournamentData.chpp_only_join);
      setEditLeagueType(tournamentData.league_type);
      setEditLeagueCategory(tournamentData.league_category || 'male');
      setEditRegistrationType(tournamentData.registration_type || 'Organizer-Managed');
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
        now: new Date(),
      });
      setScheduleMode(reconciledDraft.mode);
      setScheduleStartSlotId(reconciledDraft.selectedStartSlotId || '');

      const { data: roundsData } = await supabase
        .from('rounds')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .order('round_number', { ascending: true });

      const { data: matchesDataRaw } = await supabase
        .from('matches')
        .select(
          `
          *,
          status,
          ht_match_id,
          match_type,
          home_team:teams!matches_home_team_id_fkey(name, ht_team_id, logo_url, country_name, league_level, active, manager_name, hattrick_user_id),
          away_team:teams!matches_away_team_id_fkey(name, ht_team_id, logo_url, country_name, league_level, active, manager_name, hattrick_user_id)
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
  const defaultVisibleRoundsCount = rounds.length;

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

      // 2. Also trigger a live check for HT-linked matches that may have result data.
      //    Finished-but-incomplete rows are included so an accidental manual clear can be recovered from CHPP.
      const matchesToSync = allMatches.filter(
        (m) => m.ht_match_id && (['arranged', 'ongoing', 'finished'].includes(m.status) || m.completed),
      );

      if (matchesToSync.length > 0) {
        const ids = matchesToSync.map((m) => m.ht_match_id).join(',');
        await fetch(`/api/chpp/live-matches?tournament_id=${tournament.id}&match_ids=${ids}`);
      }

      await fetchFixturesOnly();
    } catch (err: any) {
      console.error(err.message);
    } finally {
      setIsRefreshingFixtures(false);
    }
  }, [tournament, isRefreshingFixtures, fetchFixturesOnly, allMatches]);

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

  const handleTabChange = (tab: 'standings' | 'fixtures' | 'guestbook' | 'news' | 'admin') => {
    if (tab !== activeTab) {
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

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    setPassword('');
    setAdminAuthError(false);
    setFailedLoginAttempt(false);
    setSelectedAnnouncementTemplate(null);
    localStorage.removeItem(`admin_pw_${slug}`);
    localStorage.removeItem(`admin_auth_${slug}`);
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

  const handleAnnouncementPublish = async () => {
    const trimmedContent = adminAnnouncementContent.trim();
    if (!trimmedContent) return;

    setIsPublishingAnnouncement(true);
    try {
      await createAnnouncement({
        content: trimmedContent,
        templateKey: selectedAnnouncementTemplate,
        visibility: isPublicAnnouncement ? 'public' : 'participants',
        source: 'admin',
      });
      setAdminAnnouncementContent('');
      setSelectedAnnouncementTemplate(null);
      setIsPublicAnnouncement(false);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsPublishingAnnouncement(false);
    }
  };

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
      const { error } = await supabase
        .from('tournaments')
        .update({
          name: editName,
          is_private: editIsPrivate,
          chpp_only_join: editChppOnlyJoin,
          league_type: editLeagueType,
          league_category: editLeagueCategory,
          registration_type: editRegistrationType,
          country_limit: editCountryLimit,
          is_test: isTest,
          show_description: showEditDescription,
          description: editDescription,
          admin_email: showEditEmail ? editAdminEmail : null,
          max_teams: editMaxTeams,
        })

        .eq('id', tournament?.id);

      if (error) throw error;

      // Auto-archive if empty
      if (teams.length === 0) {
        await supabase.from('tournaments').update({ status: 'archived' }).eq('id', tournament!.id);
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
      const data = await res.json();
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
      } else {
        setNewTeamName(data.teamName);
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsFetchingTeamData(false);
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
      const { data: newTeam, error } = await supabase
        .from('teams')
        .insert([
          {
            tournament_id: tournament?.id,
            name: name.trim(),
            ht_team_id: parseInt(htId.trim()),
            active: true,
            replacement_for_team_id: oldTeamToReplaceId,
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
    if (!window.confirm(`Revive ${team?.name}?`)) return;

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
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const checkArchiveStatus = async (updatedTeams: any[]) => {
    const validatedCount = updatedTeams.filter((t) => t.active && t.joined_via_oauth).length;
    if (validatedCount === 0 && updatedTeams.some((t) => t.active)) {
      await supabase.from('tournaments').update({ is_archived: true }).eq('id', tournament?.id);
      alert('This tournament has no Hattrick validated teams left and has been archived.');
    }
  };

  const deleteTeam = async (id: string) => {
    let updatedTeams;
    const team = teams.find((t) => t.id === id);
    if (isGenerated) {
      if (window.confirm(`Are you sure you want to deactivate ${team?.name}?`)) {
        await supabase.from('teams').update({ active: false }).eq('id', id);
        updatedTeams = teams.map((t) => (t.id === id ? { ...t, active: false } : t));
        fetchData();
        checkArchiveStatus(updatedTeams);
      }
      return;
    }

    if (window.confirm(`Remove ${team?.name} from the tournament?`)) {
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
      checkArchiveStatus(updatedTeams);
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
        '\n\n⚠️ ODD NUMBER OF TEAMS: Each round one team will have a BYE. BYE rules: teams with a BYE can challenge anyone outside the tournament that round and still get points if they report the result.';
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
      try {
        await createAnnouncement({
          content: 'Tournament schedule dates were updated, please check Fixtures & Results.',
          templateKey: 'schedule-change',
          visibility: 'participants',
          source: 'system',
        });
      } catch (announcementError) {
        console.warn('Schedule was regenerated, but the participant announcement could not be published.', announcementError);
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

  const myHtUserId = localStorage.getItem('my_ht_user_id');
  const hasJoined = teams.some((t) => t.hattrick_user_id === Number(myHtUserId) && t.active);
  const canJoinTournament = Boolean(
    tournament &&
      !hasJoined &&
      (!isGenerated || (isGenerated && (teams.some((t) => !t.active && !t.is_placeholder) || teams.length % 2 !== 0))),
  );
  const dismissedAnnouncementIds = new Set(
    announcementDismissals
      .filter((dismissal) => dismissal.announcement_id)
      .map((dismissal) => dismissal.announcement_id as string),
  );
  const joinedNoticeDismissed =
    isJoinedNoticeDismissed ||
    announcementDismissals.some((dismissal) => dismissal.notice_key === JOINED_NOTICE_KEY);
  const selectedTournamentMessage = selectTournamentMessage({
    canJoin: canJoinTournament,
    hasJoined,
    currentHtUserId,
    joinedNoticeDismissed,
    announcements,
    dismissedAnnouncementIds,
    publicDismissedAnnouncementIds: dismissedPublicAnnouncementIds,
  });

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!tournament) return <div className={styles.loading}>Tournament not found</div>;

  const is120minMode = tournament.scoring_mode === '120m' || tournament.scoring_mode === '120min';

  const isMobile = window.innerWidth <= 620;
  const publicUrl = `${window.location.origin}/t/${slug}`;
  const publicUrlDisplay = isMobile ? `...${slug}` : publicUrl;

  // Find the first round that is not fully completed
  const currentRoundId = rounds.find((r) => r.matches.some((m) => !m.completed))?.id;

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
            {isAddingDescription && (
              <div className={styles.quickAddDesc}>
                <div className={adminStyles.labelRow}>
                  <label>Add Description</label>
                  <button type="button" onClick={() => regenerateDescription(true)} className={adminStyles.iconBtn}>
                    <ArrowClockwise size={20} weight="bold" />
                  </button>
                </div>

                <div className={styles.quickAddActions}>
                  <Button size="sm" variant="primary" onClick={handleQuickDescriptionAdd} disabled={isUpdatingSettings}>
                    {isUpdatingSettings ? 'Adding...' : 'Add'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setIsAddingDescription(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {tournament.description && tournament.show_description && (
              <div className={styles.tournamentDescription}>
                <p>{tournament.description}</p>
              </div>
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

        {isGenerated && !isHealthQuotaMet() && (
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

        {isJoining && (
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

        <div className={styles.description}>
          {!tournament.description && isAdminAuthenticated && !isAddingDescription && (
            <button className={styles.addDescBtn} onClick={() => setIsAddingDescription(true)}>
              + Add description
            </button>
          )}
        </div>
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
        <button className={isNewsTab ? styles.active : ''} onClick={() => handleTabChange('news')}>
          News
        </button>
        <button className={activeTab === 'admin' ? styles.active : ''} onClick={() => handleTabChange('admin')}>
          Admin
        </button>
      </div>

      {activeTab === 'fixtures' && (
        <FixturesView
          key={tournament?.id}
          rounds={rounds}
          upcomingRoundIndex={upcomingRoundIndex}
          defaultVisibleRoundsCount={defaultVisibleRoundsCount}
          expandedRounds={expandedRounds}
          toggleRound={toggleRound}
          tournament={tournament}
          isRefreshingFixtures={isRefreshingFixtures}
          handleRefreshFixtures={handleRefreshFixtures}
          copied={copied}
          setCopied={setCopied}
          warnings={warnings}
          liveData={liveData}
          canJoinTournament={canJoinTournament}
          isConnecting={isConnecting}
          onJoinWithHattrick={() => {
            setIsConnecting(true);
            window.location.href = `/api/auth/init?tournament_id=${tournament?.id}`;
          }}
        />
      )}

      {isNewsTab && (
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
                      {myTeam.logo_url && <img src={myTeam.logo_url} alt={myTeam.name} />}
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
      )}

      {activeTab === 'standings' && (
        <div className={styles.standingsContainer}>
          <StandingsView
            standings={standings}
            is120minMode={is120minMode}
            myHtUserId={myHtUserId}
            tournament={tournament}
            lastSeenMap={lastSeenMap}
            onRefreshPresence={fetchPresenceOnly}
          />
          <aside className={styles.statsSidebar}>
            <MottoWidget items={TOURNAMENT_DEFAULT} theme="dark" variant="sidebar" />
            <ChatView
              messages={chatMessages}
              onSendMessage={handlePostChat}
              myHtUserId={myHtUserId ? Number(myHtUserId) : null}
              leagueManagerIds={teams.map((t) => t.hattrick_user_id).filter((id): id is number => !!id)}
              teamNames={teams.reduce((acc, t) => ({ ...acc, [t.hattrick_user_id || 0]: t.name }), {})}
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
                tournament.organizer_name && (
                  <div className={styles.organizerInfo}>
                    <span className={styles.organizerLabel}>Organizer: </span>
                    <span className={styles.organizerName}>
                      {tournament.organizer_id && (
                        <a
                          href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${tournament.organizer_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${styles.htLink} ${styles.headerBadge}`}
                        >
                          {tournament.organizer_name}{' '}
                          <ArrowUpRight size={16} weight="bold" style={{ marginLeft: '0.25rem' }} />
                        </a>
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
                        <label>Registration Type</label>
                        <select
                          value={editRegistrationType}
                          onChange={(e) => setEditRegistrationType(e.target.value as any)}
                          disabled={teams.length > 0 && !isSuperAdmin}
                          className={adminStyles.selectField}
                        >
                          <option value="validated">Hattrick Validated (CHPP)</option>
                          <option value="manual">Organizer-Managed</option>
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
                              ></button>
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
                    </div>
                    <Button onClick={updateSettings} disabled={isUpdatingSettings} variant="primary" size="sm">
                      {isUpdatingSettings ? 'Saving...' : 'Save Settings'}
                    </Button>
                  </SectionCard>

                  {!isGenerated && (
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
                      currentRoundId={currentRoundId}
                    />
                  )}

                  {isGenerated && (
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
                      isGenerating={isGenerating}
                      onGenerate={generateSchedule}
                      tournamentTeamLimit={editMaxTeams}
                      rescheduleDraft={rescheduleDraft}
                      onRescheduleFromRoundChange={handleRescheduleFromRoundChange}
                      onRescheduleStartSlotIdChange={handleRescheduleStartSlotIdChange}
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
                          {tournament.registration_type === 'Hattrick Validated (CHPP)' ? 'Invite Team' : 'Add Team'}
                        </h3>
                        {tournament.registration_type === 'Hattrick Validated (CHPP)' && (
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
                              {tournament.registration_type === 'Hattrick Validated (CHPP)' ? (
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
                                  {isSavingTeam ? 'Saving...' : <></>}
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

                <Tooltip id="admin-tooltip" />
              </div>

              <div className={adminStyles.simulatorSection}>
                <h3 className={adminStyles.sectionTitle}>Admin announcements</h3>
                <p className={adminStyles.smallNote}>
                  Publish a dismissible message in the top tournament notice area.
                </p>

                <div className={adminStyles.inviteActionArea}>
                  <textarea
                    value={adminAnnouncementContent}
                    onChange={(e) => setAdminAnnouncementContent(e.target.value)}
                    placeholder="Write announcement..."
                    className={adminStyles.inviteTextarea}
                  />

                  <div className={adminStyles.announcementChips}>
                    {ANNOUNCEMENT_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className={selectedAnnouncementTemplate === template.id ? adminStyles.activeChip : ''}
                        onClick={() => {
                          setSelectedAnnouncementTemplate(template.id);
                          setAdminAnnouncementContent(template.content);
                        }}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>

                  <label className={adminStyles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={isPublicAnnouncement}
                      onChange={(event) => setIsPublicAnnouncement(event.target.checked)}
                    />
                    Public. Visible to guest visitors
                  </label>

	                  <div className={adminStyles.smallNote}>
	                    {selectedAnnouncement ? `${selectedAnnouncement.label} template selected` : 'No template selected.'}
	                  </div>

	                  <div className={`${styles.joinedNotice} ${adminStyles.announcementPreview}`}>
	                    <div className={styles.joinedNoticeContent}>
	                      <span>{deferredAdminAnnouncementContent.trim() || 'Message preview will appear here.'}</span>
	                    </div>
	                    <button className={styles.dismissBtn} type="button" disabled>
	                      <X size={18} weight="bold" />
	                    </button>
	                  </div>

	                  <div className={styles.formActionRow}>
	                    <Button
	                      variant="primary"
                      size="sm"
                      onClick={handleAnnouncementPublish}
                      disabled={isPublishingAnnouncement || !adminAnnouncementContent.trim()}
                    >
                      {isPublishingAnnouncement ? 'Publishing...' : 'Publish'}
                    </Button>
                  </div>
                </div>

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
                <Button variant="outline" size="sm" onClick={() => window.confirm('Pause this tournament?')}>
                  Pause Tournament
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.confirm('Archive this tournament? (Only if seasons finished)')}
                >
                  Archive Tournament
                </Button>
                <Button variant="outline" size="sm" onClick={handleAdminLogout}>
                  Logout
                </Button>
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
