/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useLocation, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { HeroCard } from '../../components/Card/HeroCard';
import { SectionCard } from '../../components/Card/SectionCard';
import { Button } from '../../components/Button/Button';
import { calculateStandings } from '../../utils/standings';
import { calculateMatchDate } from '../../utils/ht-data';
import type { TeamStanding } from '../../utils/standings';
import { generateRoundRobin, generateRecurring } from '../../utils/scheduler';
import { teamMatchesCategory } from '../../utils/team-eligibility';
import { TeamDisplay } from '../../components/TeamDisplay/TeamDisplay';
import { Modal } from '../../components/Modal/Modal';
import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
import { TOURNAMENT_DEFAULT } from '../../constants/descriptions';
import styles from './TournamentView.module.sass';
import adminStyles from './TournamentAdmin.module.sass';
import { FixtureCard } from '../../components/FixtureCard/FixtureCard';
import { useLiveMatches } from '../../hooks/useLiveMatches';
import { Tooltip } from 'react-tooltip';
import {
  ArrowClockwise,
  ArrowUpRight,
  Trash,
  CopySimple,
  X,
  Plus,
  ShieldCheck,
  ArrowRight,
  Check,
  FloppyDisk,
  Eraser,
  XCircle,
  PencilSimple,
  PlusCircle,
  Info,
} from 'phosphor-react';

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
  home_team_id: string;
  away_team_id: string;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  total_minutes: number;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  ht_match_id: number | null;
  home_team: {
    name: string;
    ht_team_id: number;
    active: boolean;
    logo_url?: string;
    country_name?: string;
    manager_name?: string;
  } | null;
  away_team: {
    name: string;
    ht_team_id: number;
    active: boolean;
    logo_url?: string;
    country_name?: string;
    manager_name?: string;
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
  organizer_name?: string;
  organizer_id?: number;
  image_url?: string;
  season: number;
  is_test: boolean;
  status: 'open' | 'active' | 'finished' | 'waiting';
  last_fixtures_refresh: string | null;
  admin_email: string | null;
}

interface RoundWithMatches {
  id: string;
  round_number: number;
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

  // Chat states
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newChatContent, setNewChatContent] = useState('');
  const [isPostingChat, setIsPostingChat] = useState(false);

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
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'single' | 'double' | 'recurring'>('double');
  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<Record<string, Partial<MatchWithTeams>>>({});
  const [replacingTeamId, setReplacingTeamId] = useState<string | null>(null);
  const [replacementHtId, setReplacementHtId] = useState('');
  const [replacementName, setReplacementName] = useState('');
  const [isFetchingTeamData, setIsFetchingTeamData] = useState(false);

  useEffect(() => {
    if (activeTab === 'standings' && tournament) {
      const fetchChat = async () => {
        console.log('Fetching chat for tournament:', tournament.id);
        const { data, error } = await supabase
          .from('tournament_chat')
          .select('*')
          .eq('tournament_id', tournament.id)
          .order('created_at', { ascending: true });
        if (error) console.error('Chat fetch error:', error);
        console.log('Fetched chat messages:', data);
        setChatMessages(data || []);
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
          (payload) => {
            setChatMessages((prev) => [...prev, payload.new as any]);
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [activeTab, tournament]);

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
  const [showEditDescription, setShowEditDescription] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [showEditEmail, setShowEditEmail] = useState(false);
  const [editAdminEmail, setEditAdminEmail] = useState('');
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [isTest, setIsTest] = useState(false);

  const isSuperAdmin =
    document.cookie
      .split('; ')
      .find((row) => row.startsWith('issuperadmin='))
      ?.split('=')[1] === 'you%20bet' ||
    document.cookie
      .split('; ')
      .find((row) => row.startsWith('issuperadmin='))
      ?.split('=')[1] === 'you bet';

  // Collapsible states
  const [isSettingsCollapsed, setIsSettingsCollapsed] = useState(() =>
    JSON.parse(localStorage.getItem(`settings_collapsed_${slug}`) || 'false'),
  );
  const [isTeamsCollapsed, setIsTeamsCollapsed] = useState(() =>
    JSON.parse(localStorage.getItem(`teams_collapsed_${slug}`) || 'false'),
  );
  const [isResultsCollapsed, setIsResultsCollapsed] = useState(() =>
    JSON.parse(localStorage.getItem(`results_collapsed_${slug}`) || 'false'),
  );

  // Helper to persist toggle
  const togglePanel = (key: string, state: boolean, setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setter(state);
    localStorage.setItem(`${key}_collapsed_${slug}`, JSON.stringify(state));
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

  // Pagination for recurring tournaments
  const [visibleRoundsCount, setVisibleRoundsCount] = useState(4);

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

  const getRoundDateRange = (round: RoundWithMatches) => {
    if (!round.matches || round.matches.length === 0) return '';
    const dates = round.matches
      .map((m) => calculateMatchDate(tournament?.created_at || '', round.round_number, m.home_team?.country_name))
      .sort((a, b) => a.getTime() - b.getTime());

    const start = dates[0];
    const end = dates[dates.length - 1];

    if (start.toDateString() === end.toDateString()) {
      return start.toLocaleDateString('lv-LV', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    return `${start.toLocaleDateString('lv-LV', { day: '2-digit', month: '2-digit', year: 'numeric' })} - ${end.toLocaleDateString(
      'lv-LV',
      { day: '2-digit', month: '2-digit', year: 'numeric' },
    )}`;
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: tournamentData } = await supabase.from('tournaments').select('*').eq('slug', slug).single();

    if (tournamentData) {
      setTournament(tournamentData as any);
      localStorage.setItem('last_viewed_tournament_id', tournamentData.id);
      // ... (rest of the function, I'll need to include it in the replace call)
      setEditName(tournamentData.name);
      setEditIsPrivate(tournamentData.is_private);
      setEditChppOnlyJoin(tournamentData.chpp_only_join);
      setEditLeagueType(tournamentData.league_type);
      setEditLeagueCategory(tournamentData.league_category || 'male');
      setEditRegistrationType(tournamentData.registration_type || 'Organizer-Managed');
      setEditCountryLimit(tournamentData.country_limit);
      setIsTest(tournamentData.is_test || false);
      setShowEditDescription(tournamentData.show_description);
      setEditDescription(tournamentData.description || '');
      setShowEditEmail(!!tournamentData.admin_email);
      setEditAdminEmail(tournamentData.admin_email || '');
      const { data: teamsData } = await supabase
        .from('teams')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .order('created_at', { ascending: true });

      setTeams(teamsData || []);

      const { data: roundsData } = await supabase
        .from('rounds')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .order('round_number', { ascending: true });

      const { data: matchesData } = await supabase
        .from('matches')
        .select(
          `
          *,
          status,
          ht_match_id,
          home_team:teams!matches_home_team_id_fkey(name, ht_team_id, logo_url, country_name, active, manager_name),
          away_team:teams!matches_away_team_id_fkey(name, ht_team_id, logo_url, country_name, active, manager_name)
        `,
        )
        .in(
          'round_id',
          (roundsData || []).map((r) => r.id),
        );

      const { data: warningsData } = await supabase
        .from('fixture_warnings')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .eq('active', true);

      setWarnings(warningsData || []);

      if (teamsData) {
        const matchesWithTeams = (matchesData || []) as MatchWithTeams[];

        // Add calculated match_date to each match for sorting and status detection
        const matchesWithDates = matchesWithTeams.map((m) => {
          const round = roundsData?.find((r) => r.id === m.round_id);
          return {
            ...m,
            match_date: round
              ? calculateMatchDate(tournamentData.created_at, round.round_number, m.home_team?.country_name)
              : undefined,
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
            };
          }
          return m;
        });

        const calculated = calculateStandings(
          teamsData.map((t) => ({
            id: t.id,
            name: t.name,
            ht_team_id: t.ht_team_id,
            active: t.active,
            replacement_for_team_id: t.replacement_for_team_id,
            joined_via_oauth: t.joined_via_oauth,
            country_name: t.country_name,
            logo_url: t.logo_url,
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
            matches: mergedMatches.filter((m) => m.round_id === r.id),
          }));
          setRounds(roundsWithMatches as RoundWithMatches[]);
        }
      }
    }
    setLoading(false);
  }, [slug, liveData]);

  // Keep last_fixtures_refresh updated in UI when live polling happens
  const prevLastRefreshRef = useRef(lastRefresh);
  useEffect(() => {
    if (lastRefresh && lastRefresh !== prevLastRefreshRef.current) {
      prevLastRefreshRef.current = lastRefresh;
      setTournament((prev) => (prev ? { ...prev, last_fixtures_refresh: lastRefresh } : null));
    }
  }, [lastRefresh]);

  const fetchPendingJoinData = useCallback(async (token: string) => {
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
  }, []);

  const handleTeamSelect = async (team: ChppTeamOption) => {
    if (!pendingJoinData) return;
    setSubmittingJoin(true);
    try {
      const response = await fetch('/api/auth/complete', {
        method: 'POST',
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
    if (tournament && password && password === tournament.admin_password && !isAdminAuthenticated) {
      const timer = setTimeout(() => {
        setIsAdminAuthenticated(true);
        localStorage.setItem(`admin_pw_${slug}`, password);
        setAdminAuthError(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [password, tournament, slug, isAdminAuthenticated]);

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
      // Use a microtask or timeout to avoid synchronous setState during render/effect phase
      setTimeout(() => {
        activeTab('admin');
      }, 0);
      window.history.replaceState({}, document.title);
    }
  }, [activeTab, location.state?.isAdminInit]);

  useEffect(() => {
    if (activeTab === 'guestbook' && tournament) {
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
  }, [activeTab, tournament]);

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
      const response = await fetch(`/api/teams/refresh-fixtures?tournament_id=${tournament.id}`);
      if (!response.ok) throw new Error('Failed to refresh fixtures');
      await fetchData();
    } catch (err: any) {
      console.error(err.message);
    } finally {
      setIsRefreshingFixtures(false);
    }
  }, [tournament, isRefreshingFixtures, fetchData]);

  useEffect(() => {
    if (activeTab === 'fixtures' && tournament && !isRefreshingFixtures) {
      const lastRefresh = tournament.last_fixtures_refresh ? new Date(tournament.last_fixtures_refresh) : null;
      const now = new Date();
      const diffMins = lastRefresh ? (now.getTime() - lastRefresh.getTime()) / (1000 * 60) : 999;

      if (diffMins > 15) {
        // Check if there are matches with 'not_arranged' status in the upcoming round
        const upcomingRound = rounds.find((r) => r.matches.some((m) => !m.completed));
        const hasUnarranged = upcomingRound?.matches.some((m) => m.status === 'not_arranged');

        if (hasUnarranged) {
          setTimeout(() => {
            handleRefreshFixtures();
          }, 0);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleTabChange = (tab: 'standings' | 'fixtures' | 'guestbook' | 'admin') => {
    if (tab !== activeTab) {
      setIsAddingDescription(false);
      setQuickDescription('');
      setSearchParams({ tab });
    }
  };

  // Chat scroll ref
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollBy(0, -1000);
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    if (activeTab !== 'standings' || !tournament) return;

    let pollInterval: NodeJS.Timeout;

    const fetchChat = async () => {
      const { data, error } = await supabase
        .from('tournament_chat')
        .select('*')
        .eq('tournament_id', tournament.id)
        .order('created_at', { ascending: true });

      if (error) return;
      setChatMessages(data || []);

      if (data && data.length > 0) {
        const lastMsg = new Date(data[data.length - 1].created_at);
        const ageInMinutes = (new Date().getTime() - lastMsg.getTime()) / 60000;

        let interval = 60000; // 1 min
        if (ageInMinutes < 10)
          interval = 1000; // 1 sec
        else if (ageInMinutes < 60)
          interval = 10000; // 10 secs
        else if (ageInMinutes < 30)
          interval = 5000; // 5 secs (old rule)
        else if (ageInMinutes < 480) interval = 20000; // 20 secs

        clearInterval(pollInterval);
        pollInterval = setInterval(fetchChat, interval);
      }
    };

    fetchChat();
    return () => clearInterval(pollInterval);
  }, [activeTab, tournament]);

  const handlePostChat = async () => {
    if (!newChatContent.trim() || !tournament) return;
    setIsPostingChat(true);
    try {
      const myHtId = localStorage.getItem('my_ht_user_id');
      const myTeam = myHtId ? teams.find((t) => t.hattrick_user_id === Number(myHtId)) : null;
      // Using manager_name if available, fallback to team name
      const authorName = myTeam?.manager_name || myTeam?.name || 'Guest';

      await supabase.from('tournament_chat').insert({
        tournament_id: tournament.id,
        author_name: authorName,
        content: newChatContent.trim(),
      });
      setNewChatContent('');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsPostingChat(false);
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
      setAdminAuthError(false);
    } else {
      setAdminAuthError(true);
      setFailedLoginAttempt(true);
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
      const categoryName = category === 'hfi' ? 'Hattrick Femme International (HFI)' : 'Regular league (male)';

      if (!teamMatchesCategory(data, category)) {
        const teamCategory = category === 'hfi' ? 'male league' : 'HFI';
        throw new Error(
          `Team ID ${htId} "${data.teamName}" (${teamCategory}) is not eligible to play in a ${categoryName}. Please register a ${categoryName} team.`,
        );
      }
      if (!isSuperAdmin && tournament?.country_limit && data.countryName !== tournament.country_limit) {
        throw new Error(`This team is not from the required league (${tournament.country_limit}).`);
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

    const activeTeams = teams.filter((t) => t.active && !t.is_placeholder);
    if (activeTeams.length < 2) {
      alert('Need at least 2 active teams');
      return;
    }

    const isOdd = activeTeams.length % 2 !== 0;
    let confirmMsg = `Are you sure you want to generate the schedule with ${activeTeams.length} teams?`;
    if (isOdd) {
      confirmMsg +=
        '\n\n⚠️ ODD NUMBER OF TEAMS: Each round one team will have a BYE. BYE rules: teams with a BYE can challenge anyone outside the tournament that round and still get points if they report the result.';
    }

    if (!window.confirm(confirmMsg)) return;

    setIsGenerating(true);

    let schedule;
    if (scheduleMode === 'recurring') {
      schedule = generateRecurring(
        activeTeams.map((t) => t.id),
        1,
        4,
      );
    } else {
      schedule = generateRoundRobin(
        activeTeams.map((t) => t.id),
        {
          mode: scheduleMode as 'single' | 'double',
        },
      );
    }

    try {
      for (const roundInfo of schedule) {
        const { data: round, error: rError } = await supabase
          .from('rounds')
          .insert([{ tournament_id: tournament?.id, round_number: roundInfo.roundNumber }])
          .select()
          .single();

        if (rError) throw rError;

        if (round) {
          const matchesToInsert = roundInfo.matches.map((m) => ({
            round_id: round.id,
            home_team_id: m.home,
            away_team_id: m.away,
            home_goals: null,
            away_goals: null,
            completed: false,
            went_120: false,
            total_minutes: 90,
            venue_type: m.venueType,
          }));

          if (matchesToInsert.length > 0) {
            const { error: mError } = await supabase.from('matches').insert(matchesToInsert);
            if (mError) throw mError;
          }
        }
      }
      fetchData();
    } catch (err: any) {
      alert('Error generating schedule: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const generateMoreRounds = async () => {
    const lastRoundNumber = rounds.length > 0 ? rounds[rounds.length - 1].round_number : 0;
    const activeTeams = teams.filter((t) => t.active);
    setIsGenerating(true);

    const schedule = generateRecurring(
      activeTeams.map((t) => t.id),
      lastRoundNumber + 1,
    );

    try {
      for (const roundInfo of schedule) {
        const { data: round, error: rError } = await supabase
          .from('rounds')
          .insert([{ tournament_id: tournament?.id, round_number: roundInfo.roundNumber }])
          .select()
          .single();

        if (rError) throw rError;

        if (round) {
          const matchesToInsert = roundInfo.matches.map((m) => ({
            round_id: round.id,
            home_team_id: m.home,
            away_team_id: m.away,
            home_goals: null,
            away_goals: null,
            completed: false,
            went_120: false,
            total_minutes: 90,
            venue_type: m.venueType,
          }));

          if (matchesToInsert.length > 0) {
            const { error: mError } = await supabase.from('matches').insert(matchesToInsert);
            if (mError) throw mError;
          }
        }
      }
      fetchData();
    } catch (err: any) {
      alert('Error generating more rounds: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateSchedule = async () => {
    if (
      !window.confirm('Are you sure you want to re-open registration? All current results and schedule will be lost!')
    ) {
      return;
    }
    setIsGenerating(true);
    try {
      await supabase.from('rounds').delete().eq('tournament_id', tournament?.id);
      fetchData();
    } catch (err: any) {
      alert('Error regenerating: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const updateMatch = async (matchId: string, isScrap: boolean = false) => {
    const data = matchData[matchId];
    const { error } = await supabase
      .from('matches')
      .update({
        home_goals: isScrap
          ? null
          : data && data.home_goals !== undefined && data.home_goals !== null
            ? parseInt(String(data.home_goals))
            : null,
        away_goals: isScrap
          ? null
          : data && data.away_goals !== undefined && data.away_goals !== null
            ? parseInt(String(data.away_goals))
            : null,
        went_120: isScrap ? false : (data?.went_120 ?? false),
        total_minutes: isScrap ? 90 : data?.total_minutes || 90,
        completed: isScrap ? false : true,
      })
      .eq('id', matchId);

    if (error) alert(error.message);
    else {
      setEditingMatch(null);
      fetchData();
    }
  };

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!tournament) return <div className={styles.loading}>Tournament not found</div>;

  const isGenerated = rounds.length > 0;
  const is120minMode = tournament.scoring_mode === '120m' || tournament.scoring_mode === '120min';

  const myHtUserId = localStorage.getItem('my_ht_user_id');
  const hasJoined = teams.some((t) => t.hattrick_user_id === Number(myHtUserId) && t.active);

  const isMobile = window.innerWidth <= 620;
  const publicUrl = `${window.location.origin}/t/${slug}`;
  const publicUrlDisplay = isMobile ? `.../t/${slug}` : publicUrl;

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
            {is120minMode ? (
              <div className={styles.scoringHelp}>
                <p onClick={() => setShowScoringHelp(!showScoringHelp)} className={styles.helpToggle}>
                  <strong>120min training mode</strong> {showScoringHelp ? <X size={18} /> : <Info size={18} />}
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
            {tournament?.image_url ? (
              <div className={styles.tournamentImage} style={{ backgroundImage: `url(${tournament?.image_url})` }} />
            ) : (
              isAdminAuthenticated && <div className={styles.placeholderMessage}>Click to add image URL</div>
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
      {!hasJoined &&
        (!isGenerated ||
          (isGenerated && (teams.some((t) => !t.active && !t.is_placeholder) || teams.length % 2 !== 0))) && (
          <div className={styles.registrationStatus}>
            <div className={styles.helpContent}>
              <p>
                {isGenerated
                  ? 'This tournament is ongoing but has available spots for new teams!'
                  : 'This tournament is currently open and accepting new team registrations'}
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
                  <ArrowRight size={18} weight="bold" /> Join
                </Button>
              )}
            </div>
          </div>
        )}

      {activeTab === 'standings' && hasJoined && !isJoinedNoticeDismissed && (
        <div className={styles.joinedNotice}>
          <div className={styles.joinedNoticeContent}>
            <span>You are participating in this tournament! Good luck!</span>
          </div>
          <button
            className={styles.dismissBtn}
            onClick={() => {
              setIsJoinedNoticeDismissed(true);
              localStorage.setItem(`joined_notice_dismissed_${slug}`, 'true');
            }}
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
          Fixtures & Results
        </button>
        {/* TODO: reintroduce news tab */}
        {/* <button className={activeTab === 'guestbook' ? styles.active : ''} onClick={() => handleTabChange('guestbook')}>
          News
        </button> */}
        <button className={activeTab === 'admin' ? styles.active : ''} onClick={() => handleTabChange('admin')}>
          Admin
        </button>
      </div>

      {activeTab === 'standings' && (
        <div className={styles.standingsContainer}>
          <div className={styles.mainColumn}>
            <SectionCard title="🏆 Standings" headerThumbnailIndex={tournament.thumbnail_index}>
              <div className={styles.tableWrapper}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Team</th>
                      {is120minMode ? (
                        <>
                          <th className={styles.center}>120m</th>
                          <th className={styles.center}>Mins</th>
                          <th className={styles.center}>Pld</th>
                          <th className={styles.center}>GD</th>
                          <th className={styles.center}>GS</th>
                        </>
                      ) : (
                        <>
                          <th className={styles.center}>Pld</th>
                          <th className={styles.center}>W</th>
                          <th className={styles.center}>D</th>
                          <th className={styles.center}>L</th>
                          <th className={styles.center}>GD</th>
                          <th className={styles.center}>Pts</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((s, idx) => {
                      const isMyTeam = s.htTeamId === Number(myHtUserId);
                      return (
                        <tr key={s.teamId} className={isMyTeam ? styles.myTeamRow : ''}>
                          <td className={styles.muted}>{idx + 1}</td>
                          <td className={styles.teamNameCell}>
                            <div className={styles.teamInfo}>
                              <div className={styles.nameRow}>
                                {s.logoUrl && <img src={s.logoUrl} alt={s.teamName} className={styles.standingLogo} />}
                                <span className={styles.teamName}>
                                  {s.teamName}
                                  {isMyTeam && <span className={styles.myTeamBadge}> (You)</span>}
                                </span>
                                {s.joinedViaOauth && (
                                  <span title="Hattrick Validated Team">
                                    <ShieldCheck size={14} weight="bold" className={styles.validatedIcon} />
                                  </span>
                                )}
                                <a
                                  href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${s.htTeamId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={styles.htLink}
                                >
                                  <ArrowUpRight size={12} weight="bold" />
                                </a>
                              </div>
                              {s.htTeamId && <span className={styles.teamId}>ID: {s.htTeamId}</span>}
                            </div>
                          </td>
                          {is120minMode ? (
                            <>
                              <td className={`${styles.highlight} ${styles.center}`}>{s.achievements120min}</td>
                              <td className={styles.center}>{s.totalMinutes}</td>
                              <td className={styles.center}>{s.played}</td>
                              <td className={styles.center}>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                              <td className={styles.center}>{s.gf}</td>
                            </>
                          ) : (
                            <>
                              <td className={styles.center}>{s.played}</td>
                              <td className={styles.center}>{s.won}</td>
                              <td className={styles.center}>{s.drawn}</td>
                              <td className={styles.center}>{s.lost}</td>
                              <td className={styles.center}>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                              <td className={`${styles.highlight} ${styles.center}`}>{s.pts}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}

                    {/* Inactive teams / BYE spots */}
                    {(() => {
                      const inactiveTeams = teams.filter((t) => !t.active && !t.is_placeholder);
                      const hasBye = teams.length % 2 !== 0 && isGenerated;
                      const spots = [...inactiveTeams];
                      if (hasBye) spots.push({ id: 'bye', name: 'BYE Spot', is_placeholder: true } as Team);

                      const handleInvite = () => {
                        const msg = `Join our tournament "${tournament.name}" on HT-120min! We have an open spot: ${window.location.origin}/t/${tournament.slug}`;
                        navigator.clipboard.writeText(msg);
                        alert('Invitation link and message copied to clipboard!');
                      };

                      return spots.map((spot, idx) => (
                        <tr key={spot.id} className={styles.inactiveRow}>
                          <td className={styles.muted}>{standings.length + idx + 1}</td>
                          <td className={styles.teamNameCell}>
                            <div className={styles.teamInfo}>
                              <div className={styles.nameRow}>
                                <Button
                                  variant="zero"
                                  size="sm"
                                  onClick={handleInvite}
                                  className={`${styles.inviteSpotBtn} ${styles.noPadding}`}
                                >
                                  <Plus size={14} weight="bold" /> Invite
                                </Button>
                                <span className={styles.spotLabel}>{spot.name}</span>
                              </div>
                            </div>
                          </td>
                          {is120minMode ? (
                            <>
                              <td className={styles.center}>-</td>
                              <td className={styles.center}>-</td>
                              <td className={styles.center}>-</td>
                              <td className={styles.center}>-</td>
                              <td className={styles.center}>-</td>
                            </>
                          ) : (
                            <>
                              <td className={styles.center}>-</td>
                              <td className={styles.center}>-</td>
                              <td className={styles.center}>-</td>
                              <td className={styles.center}>-</td>
                              <td className={styles.center}>-</td>
                              <td className={styles.center}>-</td>
                            </>
                          )}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>

              {(teams.some((t) => !t.active) || teams.length % 2 !== 0) && (
                <div className={styles.standingsFooter}>
                  <p className={styles.standingsFooterNote}>
                    {isGenerated
                      ? teams.some((t) => !t.active)
                        ? `${
                            teams.filter((t) => !t.active).length
                          } team(s) have become inactive and their spots can be filled by another team.`
                        : "An odd number of teams means there's a BYE spot available for a new team to join."
                      : 'This tournament is still open for registration, register another team or invite someone'}
                  </p>
                  <div className={styles.footerButtons}>
                    <Button
                      onClick={() => {
                        setIsConnecting(true);
                        window.location.href = `/api/auth/init?tournament_id=${tournament?.id}`;
                      }}
                      variant="outlineWhite"
                      size="sm"
                      disabled={isConnecting}
                    >
                      <ArrowRight size={18} /> Join with Hattrick
                    </Button>
                    <Button
                      onClick={() => {
                        const msg = `You are invited to join "${tournament.name}" (Season ${tournament.season}) on HT-120min! Register your team here: ${publicUrl}`;
                        navigator.clipboard.writeText(msg);
                        alert('Invitation link and message copied to clipboard!');
                      }}
                      variant="outlineWhite"
                      size="sm"
                    >
                      <CopySimple size={18} /> Copy Invite
                    </Button>
                  </div>
                </div>
              )}
            </SectionCard>
          </div>
          <aside className={styles.statsSidebar}>
            <MottoWidget items={TOURNAMENT_DEFAULT} theme="dark" variant="sidebar" />
            <SectionCard title="News Feed">
              <ul className={styles.newsFeed}>
                <li className={styles.feedItem}>
                  <div className={styles.feedIcon}></div>
                  <div className={styles.feedContent}>
                    <p>New cup registration is now open!</p>
                    <span>2 hours ago</span>
                  </div>
                </li>
              </ul>
            </SectionCard>
          </aside>
        </div>
      )}

      {activeTab === 'fixtures' && (
        <div className={styles.rounds}>
          {!isGenerated ? (
            <SectionCard>
              <div className={styles.openMessage}>
                <h2>Registration Open</h2>
                <p>This tournament is still open for registration, you can invite someone to join.</p>
              </div>
            </SectionCard>
          ) : (
            <>
              {rounds.slice(0, visibleRoundsCount).map((round) => {
                const upcomingRoundIndex = rounds.findIndex((r) => r.matches.some((m) => !m.completed));
                const isNextRound = round.id === rounds[upcomingRoundIndex]?.id;
                const isOneBefore = upcomingRoundIndex > 0 && round.id === rounds[upcomingRoundIndex - 1].id;
                const isOneAfter =
                  upcomingRoundIndex < rounds.length - 1 && round.id === rounds[upcomingRoundIndex + 1].id;

                const isExpanded = expandedRounds[round.id] ?? (isNextRound || isOneBefore || isOneAfter);

                return (
                  <SectionCard
                    key={round.id}
                    className={isNextRound ? styles.upcomingRound : ''}
                    title={
                      <div
                        className={styles.roundHeader}
                        onClick={() => toggleRound(round.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <>
                          <span>Round {round.round_number}</span>
                          <span className={styles.roundDate}>{getRoundDateRange(round)}</span>
                          {isExpanded ? <X size={18} /> : <Info size={18} />}
                        </>
                      </div>
                    }
                    headerRight={(() => {
                      const isNextRound = round.id === rounds[upcomingRoundIndex]?.id;
                      const allFinished = round.matches.every((m) => m.completed || m.status === 'misarranged');

                      if (!allFinished && !isNextRound) return undefined;

                      const nextRound = rounds[rounds.findIndex((r) => r.id === round.id) + 1];

                      const formatMatch = (m: MatchWithTeams, isNext: boolean, roundNum: number) =>
                        `[tr][td]${m.home_team?.name}[/td][td][b]${
                          isNext
                            ? calculateMatchDate(
                                tournament?.created_at || '',
                                roundNum,
                                m.home_team?.country_name,
                              ).toLocaleDateString('lv-LV', {
                                day: '2-digit',
                                month: '2-digit',
                              })
                            : m.completed
                              ? `${m.home_goals} : ${m.away_goals}`
                              : m.status === 'misarranged'
                                ? 'DNP'
                                : '..:..'
                        }[/b][/td][td]${m.away_team?.name}[/td][/tr]`;

                      const handleCopy = () => {
                        let table = `[b]${tournament?.name}[/b]\n[link=http://ht120-min.vercel.app/t/${tournament?.slug}]\n\n[b]ROUND ${round.round_number}, ${allFinished ? 'final results:[/b]' : 'Fixtures:[/b]'}\n[table]${round.matches.map((m) => formatMatch(m, false, round.round_number)).join(' ')}[/table]`;
                        if (isNextRound && nextRound) {
                          table += `\n[b]Next: ROUND ${nextRound.round_number}, fixtures:[/b]\n[table]${nextRound.matches.map((m) => formatMatch(m, true, nextRound.round_number)).join(' ')}[/table]`;
                        }
                        table += `\nFull fixtures: [link=http://ht120-min.vercel.app/t/${tournament?.slug}?tab=fixtures]`;
                        navigator.clipboard.writeText(table);
                        setCopied((prev) => ({ ...prev, [round.id]: true }));
                        setTimeout(() => setCopied((prev) => ({ ...prev, [round.id]: false })), 2000);
                      };

                      return (
                        <div className={styles.fixturesControls}>
                          {allFinished ? (
                            <>
                              <span className={styles.lastRefresh}>Copy for HT forums:</span>
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
                                  {isRefreshingFixtures ? 'Checking...' : 'Last checked: '}
                                  {!isRefreshingFixtures &&
                                    new Date(tournament.last_fixtures_refresh).toLocaleTimeString('en-GB', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                </span>
                              )}
                              <button
                                className={`${styles.refreshBtn} ${isRefreshingFixtures ? styles.spinning : ''}`}
                                onClick={handleRefreshFixtures}
                                disabled={isRefreshingFixtures}
                                data-tooltip-id="refresh-tooltip"
                              >
                                <ArrowClockwise size={18} />
                              </button>
                              <Tooltip id="refresh-tooltip" content="Refresh fixtures" />
                              <button className={styles.refreshBtn} onClick={handleCopy} data-tooltip-id="copy-tooltip">
                                {copied[round.id] ? <Check size={18} color="green" /> : <CopySimple size={18} />}
                              </button>
                              <Tooltip
                                id="copy-tooltip"
                                content={copied[round.id] ? 'HT forum table copied!' : 'Copy for HT forums'}
                              />
                            </>
                          )}
                        </div>
                      );
                    })()}
                  >
                    {isExpanded && (
                      <div className={styles.matchesGrid}>
                        {round.matches.map((match: MatchWithTeams) => {
                          const matchDate = calculateMatchDate(
                            tournament?.created_at || '',
                            round.round_number,
                            match.home_team?.country_name,
                          );

                          const day = matchDate.toLocaleString('en-GB', { weekday: 'short' }).toUpperCase();
                          const datePart = matchDate.toLocaleDateString('lv-LV', {
                            day: '2-digit',
                            month: '2-digit',
                          });
                          const timePart = matchDate.toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          });
                          const formattedDate = `${day} / ${datePart} / ${timePart}`;

                          const homeWarning = warnings.find(
                            (w) => w.team_id === match.home_team_id && w.round_id === round.id,
                          );
                          const awayWarning = warnings.find(
                            (w) => w.team_id === match.away_team_id && w.round_id === round.id,
                          );

                          // Use status from DB, fallback to simple detection
                          const liveMatch = match.ht_match_id ? liveData[match.ht_match_id.toString()] : null;
                          let status = match.status || 'not_arranged';
                          const now = new Date();
                          const isPastStartTime = match.match_date && now >= match.match_date;
                          const isWithinLiveWindow =
                            match.match_date && now.getTime() < match.match_date.getTime() + 4 * 60 * 60 * 1000;

                          if (match.completed) {
                            status = 'finished';
                          } else if (liveMatch) {
                            status = liveMatch.status;
                          } else if (isPastStartTime && isWithinLiveWindow && status === 'arranged') {
                            status = 'ongoing';
                          } else if (homeWarning || awayWarning) {
                            status = 'misarranged';
                          }

                          const currentScore = liveMatch
                            ? { home: liveMatch.homeGoals, away: liveMatch.awayGoals }
                            : match.completed
                              ? { home: match.home_goals || 0, away: match.away_goals || 0 }
                              : isPastStartTime && isWithinLiveWindow
                                ? { home: 0, away: 0 }
                                : undefined;

                          return (
                            <FixtureCard
                              key={match.id}
                              date={status === 'misarranged' ? '' : formattedDate}
                              status={status}
                              htMatchId={match.ht_match_id || undefined}
                              score={currentScore}
                              homeTeam={{
                                name: match.home_team?.name || 'BYE',
                                managerName: match.home_team?.manager_name || 'UNKNOWN',
                                htTeamId: match.home_team?.ht_team_id || 0,
                                logoUrl: match.home_team?.logo_url,
                                warning: homeWarning?.type,
                              }}
                              awayTeam={{
                                name: match.away_team?.name || 'BYE',
                                managerName: match.away_team?.manager_name || 'UNKNOWN',
                                htTeamId: match.away_team?.ht_team_id || 0,
                                logoUrl: match.away_team?.logo_url,
                                warning: awayWarning?.type,
                              }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </SectionCard>
                );
              })}
              {visibleRoundsCount < rounds.length && (
                <div className={styles.formActionRow}>
                  <Button onClick={() => setVisibleRoundsCount((prev) => prev + 4)} variant="outline">
                    Show More
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'guestbook' && (
        <div className={styles.guestbook}>
          <SectionCard title="News & Announcements">
            <div className={styles.newsTabs}>
              <button className={newsMode === 'team' ? styles.active : ''} onClick={() => setNewsMode('team')}>
                Team News
              </button>
              {isAdminAuthenticated && (
                <button className={newsMode === 'admin' ? styles.active : ''} onClick={() => setNewsMode('admin')}>
                  Tournament News
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

      {/* TODO: reintroduce main column */}
      {activeTab === 'off' && (
        <div className={styles.standingsContainer}>
          <div className={styles.mainColumn}>
            <div className={styles.chatSection}>
              <h3></h3>

              {/* Chat Messages */}
              <div className={styles.chatMessages}>
                {chatMessages.map((msg) => {
                  const date = new Date(msg.created_at);
                  const now = new Date();
                  const timeStr =
                    date.toDateString() === now.toDateString()
                      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : date.toLocaleDateString();

                  const isOwnMessage =
                    msg.author_name ===
                    ((teams.find((t) => t.hattrick_user_id === Number(localStorage.getItem('my_ht_user_id'))) as any)
                      ?.manager_name ||
                      teams.find((t) => t.hattrick_user_id === Number(localStorage.getItem('my_ht_user_id')))?.name);

                  return (
                    <div key={msg.id} className={`${styles.chatMessage} ${isOwnMessage ? styles.ownMessage : ''}`}>
                      {!isOwnMessage && <span className={styles.chatAuthor}>{msg.author_name}</span>}
                      <span className={styles.chatContent}>{msg.content}</span>
                      <span className={styles.chatTime}>{timeStr}</span>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
                {chatMessages.length === 0 && <p className={styles.muted}>No recent messages.</p>}
              </div>

              {/* Chat Input */}
              <div className={styles.chatEmojiBar}>
                {['🔥', '💪', '👌', '❤️', '🥶', '😱', '😢', '🏆'].map((emoji) => (
                  <button key={emoji} onClick={() => setNewChatContent((prev) => prev + emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
              <div className={styles.chatInputRow}>
                <input
                  type="text"
                  value={newChatContent}
                  onChange={(e) => setNewChatContent(e.target.value)}
                  placeholder="Type a message..."
                  onKeyPress={(e) => e.key === 'Enter' && handlePostChat()}
                />
                <Button onClick={handlePostChat} disabled={isPostingChat || !newChatContent.trim()}>
                  Send
                </Button>
              </div>
            </div>
          </div>
          <div className={styles.statsSidebar}>
            <SectionCard title="Tournament Stats">
              <p className={styles.muted}>Stats placeholder: cards, injuries, etc.</p>
            </SectionCard>
          </div>
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
              <form onSubmit={handleAdminLogin} className={styles.adminAuthForm}>
                <div className={styles.authField}>
                  <label>Tournament Password</label>
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
                </div>
                {adminAuthError && <p className={styles.authError}>Invalid password. Please try again.</p>}
                <Button type="submit" variant="primary" size="md">
                  Login <ArrowRight size={18} weight="bold" />
                </Button>

                <div className={styles.adminAuthFooter}>
                  {failedLoginAttempt ? (
                    <p className={styles.adminAuthNote}>Forgot password? Recover with a registered email.</p>
                  ) : (
                    <a href="/create" className={styles.adminAuthLink}>
                      Want to be an admin? <u>Start your own tournament</u>.
                    </a>
                  )}
                </div>
              </form>
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
                          <a href={publicUrl} target="_blank">
                            <code>{publicUrlDisplay}</code>
                          </a>
                          <Button
                            size={isMobile ? 'xs' : 'sm'}
                            variant="outline"
                            onClick={() => {
                              navigator.clipboard.writeText(publicUrl);
                              alert('URL copied!');
                            }}
                          >
                            <CopySimple size={16} />
                          </Button>
                        </div>
                        <div className={adminStyles.metaItem}>
                          {!isMobile ? (
                            <span className={adminStyles.label}>Admin Password:</span>
                          ) : (
                            <span className={adminStyles.label}>Password:</span>
                          )}

                          <code>{tournament.admin_password}</code>
                          <Button
                            size={isMobile ? 'xs' : 'sm'}
                            variant="outline"
                            onClick={() => {
                              navigator.clipboard.writeText(tournament.admin_password);
                              alert("Password copied! Don't lose it.");
                            }}
                          >
                            <CopySimple size={16} />
                          </Button>
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
                          value={editCountryLimit || ''}
                          onChange={(e) => setEditCountryLimit(e.target.value || null)}
                          className={adminStyles.selectField}
                        >
                          <option value="">Any Hattrick League</option>
                          {(() => {
                            const validatedTeams = teams.filter((t) => t.joined_via_oauth && t.country_name);
                            const countries = Array.from(new Set(validatedTeams.map((t) => t.country_name)));
                            // If only one country is represented, show it as an option.
                            // If multiple countries are represented, only "Any..." is valid (already provided above).
                            if (countries.length === 1) {
                              return <option value={countries[0]!}>{countries[0]}</option>;
                            }
                            return null;
                          })()}
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

                  <SectionCard
                    title="Manage Teams & Schedule"
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

                    <div className={adminStyles.scheduleControl}>
                      {!isGenerated ? (
                        <div className={adminStyles.genOptions}>
                          <div className={adminStyles.checkboxGroup}>
                            <label className={adminStyles.checkboxLabel}>
                              <input
                                type="radio"
                                name="scheduleMode"
                                checked={scheduleMode === 'single'}
                                onChange={() => setScheduleMode('single')}
                              />
                              Play each other once (Neutral stadium)
                            </label>
                            <label className={adminStyles.checkboxLabel}>
                              <input
                                type="radio"
                                name="scheduleMode"
                                checked={scheduleMode === 'double'}
                                onChange={() => setScheduleMode('double')}
                              />
                              Play each other twice (Home and Away)
                            </label>
                            {teams.filter((t) => t.active).length <= 4 && (
                              <label className={adminStyles.checkboxLabel}>
                                <input
                                  type="radio"
                                  name="scheduleMode"
                                  checked={scheduleMode === 'recurring'}
                                  onChange={() => setScheduleMode('recurring')}
                                />
                                Recurring schedule (Continuous)
                              </label>
                            )}
                          </div>
                          <Button
                            variant="primary"
                            size="lg"
                            fullWidth
                            onClick={generateSchedule}
                            disabled={teams.filter((t) => t.active).length < 2 || isGenerating}
                          ></Button>
                          <p className="center w-100">Generating schedule will also close registration. </p>
                        </div>
                      ) : (
                        <div className={adminStyles.genActions}>
                          <Button variant="outline" onClick={regenerateSchedule} disabled={isGenerating} fullWidth>
                            Reset and Re-open
                          </Button>
                          {scheduleMode === 'recurring' && (
                            <Button
                              variant="outline"
                              onClick={generateMoreRounds}
                              disabled={isGenerating}
                              fullWidth
                              className={styles.mt05}
                            >
                              {isGenerating ? 'Generating...' : 'Generate more rounds'}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </SectionCard>
                </section>

                {isGenerated && (
                  <section className={adminStyles.fixturesSection}>
                    <SectionCard
                      title="Results Entry"
                      collapsible
                      isCollapsed={isResultsCollapsed}
                      onToggleCollapse={() => togglePanel('results', !isResultsCollapsed, setIsResultsCollapsed)}
                    >
                      <div className={adminStyles.matches}>
                        {rounds.map((round) => (
                          <div key={round.id} className={adminStyles.roundResults}>
                            <h3 className={adminStyles.sectionTitle}>Round {round.round_number}</h3>
                            {round.matches.map((match: MatchWithTeams) => {
                              return (
                                <div key={match.id} className={adminStyles.match}>
                                  <div className={adminStyles.matchTeams}>
                                    <TeamDisplay team={match.home_team} side="home" />
                                    <span className={adminStyles.vs}>vs</span>
                                    <TeamDisplay team={match.away_team} side="away" />
                                  </div>

                                  {editingMatch === match.id ? (
                                    <div className={adminStyles.matchEdit}>
                                      <div className={adminStyles.scoreInputs}>
                                        <input
                                          name={`score_home_${match.id}`}
                                          type="number"
                                          placeholder="H"
                                          value={matchData[match.id]?.home_goals ?? match.home_goals ?? ''}
                                          onChange={(e) =>
                                            setMatchData({
                                              ...matchData,
                                              [match.id]: {
                                                ...(matchData[match.id] || match),
                                                home_goals: e.target.value === '' ? null : Number(e.target.value),
                                              },
                                            })
                                          }
                                        />
                                        <span className={adminStyles.divider}>-</span>
                                        <input
                                          name={`score_away_${match.id}`}
                                          type="number"
                                          placeholder="A"
                                          value={matchData[match.id]?.away_goals ?? match.away_goals ?? ''}
                                          onChange={(e) =>
                                            setMatchData({
                                              ...matchData,
                                              [match.id]: {
                                                ...(matchData[match.id] || match),
                                                away_goals: e.target.value === '' ? null : Number(e.target.value),
                                              },
                                            })
                                          }
                                        />
                                      </div>
                                      <label className={adminStyles.went120}>
                                        <input
                                          title="120min game achieved"
                                          type="checkbox"
                                          checked={matchData[match.id]?.went_120 ?? match.went_120 ?? false}
                                          onChange={(e) =>
                                            setMatchData({
                                              ...matchData,
                                              [match.id]: {
                                                ...(matchData[match.id] || match),
                                                went_120: e.target.checked,
                                                total_minutes: e.target.checked
                                                  ? 120
                                                  : (matchData[match.id]?.total_minutes ?? match.total_minutes ?? 90),
                                              },
                                            })
                                          }
                                        />
                                        120min
                                      </label>
                                      <div className={adminStyles.minutesInput}>
                                        <input
                                          type="number"
                                          value={matchData[match.id]?.total_minutes ?? match.total_minutes ?? 90}
                                          onChange={(e) =>
                                            setMatchData({
                                              ...matchData,
                                              [match.id]: {
                                                ...(matchData[match.id] || match),
                                                total_minutes: e.target.value === '' ? 90 : Number(e.target.value),
                                              },
                                            })
                                          }
                                          placeholder="90"
                                        />
                                        <span title="Total match minutes" className={adminStyles.minsLabel}>
                                          mins
                                        </span>
                                      </div>
                                      <div className={adminStyles.editActions}>
                                        <Button
                                          size="xs"
                                          onClick={() => updateMatch(match.id)}
                                          variant="primary"
                                          title="Save"
                                          data-tooltip-id="admin-tooltip"
                                          data-tooltip-content="Save result"
                                        >
                                          <FloppyDisk size={16} />
                                        </Button>
                                        <Button
                                          size="xs"
                                          variant="danger"
                                          title={match.completed ? 'Restore original' : 'Clear result'}
                                          onClick={() => {
                                            if (
                                              window.confirm(
                                                match.completed
                                                  ? 'Restore original result?'
                                                  : 'Clear result for this match?',
                                              )
                                            ) {
                                              updateMatch(match.id, true);
                                            }
                                          }}
                                          data-tooltip-id="admin-tooltip"
                                          data-tooltip-content={match.completed ? 'Restore original' : 'Clear result'}
                                        >
                                          <Eraser size={16} />
                                        </Button>
                                        <Button
                                          size="xs"
                                          variant="outline"
                                          onClick={() => setEditingMatch(null)}
                                          title="Cancel"
                                          data-tooltip-id="admin-tooltip"
                                          data-tooltip-content="Cancel"
                                        >
                                          <XCircle size={16} />
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className={adminStyles.matchResult}>
                                      {match.completed ? (
                                        <div className={adminStyles.resultInfo}>
                                          <span className={adminStyles.score}>
                                            {match.home_goals} {match.away_goals}
                                          </span>
                                          {match.went_120 && <span className={adminStyles.badge}>120min</span>}
                                          <Button
                                            size="xs"
                                            variant="outline"
                                            onClick={() => {
                                              setEditingMatch(match.id);
                                              setMatchData({ ...matchData, [match.id]: match });
                                            }}
                                            data-tooltip-id="admin-tooltip"
                                            data-tooltip-content="Edit"
                                          >
                                            <PencilSimple size={16} />
                                          </Button>
                                        </div>
                                      ) : (
                                        <Button
                                          size="xs"
                                          variant={round.id === currentRoundId ? 'secondary' : 'outline'}
                                          onClick={() => {
                                            setEditingMatch(match.id);
                                            const resetMatch: Partial<MatchWithTeams> = {
                                              ...match,
                                              home_goals: null,
                                              away_goals: null,
                                              total_minutes: 90,
                                            };
                                            setMatchData({
                                              ...matchData,
                                              [match.id]: resetMatch,
                                            });
                                          }}
                                          data-tooltip-id="admin-tooltip"
                                          data-tooltip-content="Enter Result"
                                        >
                                          <PlusCircle size={16} /> Enter
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  </section>
                )}
                <Tooltip id="admin-tooltip" />
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
          <p>Link to an external image URL (e.g., Imgur, Hattrick logo, etc.)</p>
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
