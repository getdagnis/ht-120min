/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Card } from '../../components/Card/Card';
import { Button } from '../../components/Button/Button';
import { calculateStandings } from '../../utils/standings';
import type { TeamStanding } from '../../utils/standings';
import { generateRoundRobin, generateRecurring } from '../../utils/scheduler';
import { TeamDisplay } from '../../components/TeamDisplay/TeamDisplay';
import { Lineicons } from '@lineiconshq/react-lineicons';
import {
  EnterOutlined,
  Link2AngularRightOutlined,
  PlusOutlined,
  Trash3Outlined,
  RefreshCircle1ClockwiseOutlined,
  XmarkOutlined,
  PlayOutlined,
  FloppyDisk1Outlined,
  CopyAiOutlined,
  CheckOutlined,
  QuestionMarkCircleOutlined,
  HandShakeOutlined,
  Shield2CheckOutlined,
} from '@lineiconshq/free-icons';
import { DESCRIPTIONS } from '../../constants/descriptions';
import styles from './TournamentView.module.sass';
import adminStyles from './TournamentAdmin.module.sass';

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
  home_team: { name: string; ht_team_id: number; active: boolean; logo_url?: string; country_name?: string };
  away_team: { name: string; ht_team_id: number; active: boolean; logo_url?: string; country_name?: string };
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
  is_placeholder?: boolean;
}

interface Tournament {
  id: string;
  slug: string;
  name: string;
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
  season: number;
  is_test: boolean;
  status: 'open' | 'active' | 'finished' | 'waiting';
}

interface RoundWithMatches {
  id: string;
  round_number: number;
  matches: MatchWithTeams[];
}

export const TournamentView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [rounds, setRounds] = useState<RoundWithMatches[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'standings' | 'fixtures' | 'admin'>(
    location.state?.isAdminInit ? 'admin' : 'standings',
  );

  // Admin states
  const [password, setPassword] = useState(localStorage.getItem(`admin_pw_${slug}`) || '');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
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

  // Tournament settings states
  const [editName, setEditName] = useState('');
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [editChppOnlyJoin, setEditChppOnlyJoin] = useState(true);
  const [editLeagueType, setEditLeagueType] = useState('male');
  const [editLeagueCategory, setEditLeagueCategory] = useState<'male' | 'hfi'>('male');
  const [editRegistrationType, setEditRegistrationType] = useState<'Hattrick Validated (CHPP)' | 'Organizer-Managed'>('Hattrick Validated (CHPP)');
  const [editCountryLimit, setEditCountryLimit] = useState<string | null>(null);
  const [showEditDescription, setShowEditDescription] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [isTest, setIsTest] = useState(false);

  const isSuperAdmin = document.cookie.split('; ').find(row => row.startsWith('issuperadmin='))?.split('=')[1] === 'you%20bet' || document.cookie.split('; ').find(row => row.startsWith('issuperadmin='))?.split('=')[1] === 'you bet';

  // Collapsible states
  const [isSettingsCollapsed, setIsSettingsCollapsed] = useState(true);
  const [isTeamsCollapsed, setIsTeamsCollapsed] = useState(() => {
    const saved = localStorage.getItem(`teams_collapsed_${slug}`);
    return saved ? JSON.parse(saved) : false;
  });

  // Join states
  const [isJoining, setIsJoining] = useState(false);
  const [joinTeamId, setJoinTeamId] = useState('');
  const [joinTeamName, setJoinTeamName] = useState('');

  // Pagination for recurring tournaments
  const [visibleRoundsCount, setVisibleRoundsCount] = useState(4);

  // UI state
  const [showScoringHelp, setShowScoringHelp] = useState(false);
  const [isAddingDescription, setIsAddingDescription] = useState(false);
  const [quickDescription, setQuickDescription] = useState('');

  const regenerateDescription = (isQuick: boolean) => {
    const randomDesc = DESCRIPTIONS[Math.floor(Math.random() * DESCRIPTIONS.length)];
    if (isQuick) setQuickDescription(randomDesc);
    else setEditDescription(randomDesc);
  };

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

  const fetchData = useCallback(async () => {
    const { data: tournamentData } = await supabase.from('tournaments').select('*').eq('slug', slug).single();

    if (tournamentData) {
      setTournament(tournamentData);
      setEditName(tournamentData.name);
      setEditIsPrivate(tournamentData.is_private);
      setEditChppOnlyJoin(tournamentData.chpp_only_join);
      setEditLeagueType(tournamentData.league_type);
      setEditLeagueCategory(tournamentData.league_category || 'male');
      setEditRegistrationType(tournamentData.registration_type || 'validated');
      setEditCountryLimit(tournamentData.country_limit);
      setIsTest(tournamentData.is_test || false);
      setShowEditDescription(tournamentData.show_description);
      setEditDescription(tournamentData.description || '');

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
          home_team:teams!matches_home_team_id_fkey(name, ht_team_id, logo_url, country_name, active),
          away_team:teams!matches_away_team_id_fkey(name, ht_team_id, logo_url, country_name, active)
        `,
        )
        .in(
          'round_id',
          (roundsData || []).map((r) => r.id),
        );

      if (teamsData) {
        const matchesWithTeams = (matchesData || []) as MatchWithTeams[];
        const calculated = calculateStandings(
          teamsData.map((t) => ({
            id: t.id,
            name: t.name,
            ht_team_id: t.ht_team_id,
            active: t.active,
            replacement_for_team_id: t.replacement_for_team_id,
          })),
          matchesWithTeams,
          tournamentData.scoring_mode as any,
        );
        setStandings(calculated);

        if (roundsData) {
          const roundsWithMatches = roundsData.map((r) => ({
            ...r,
            matches: matchesWithTeams.filter((m) => m.round_id === r.id),
          }));
          setRounds(roundsWithMatches as RoundWithMatches[]);
        }
      }

      if (password === tournamentData.admin_password) {
        setIsAdminAuthenticated(true);
      }
    }
    setLoading(false);
  }, [slug, password]);

  useEffect(() => {
    fetchData();

    // Check for error param from OAuth
    const params = new URLSearchParams(window.location.search);
    const errorMsg = params.get('error');
    if (errorMsg) {
      alert(errorMsg);
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [fetchData]);

  useEffect(() => {
    if (location.state?.isAdminInit) {
      // Use a microtask or timeout to avoid synchronous setState during render/effect phase
      setTimeout(() => {
        setActiveTab('admin');
      }, 0);
      window.history.replaceState({}, document.title);
    }
  }, [location.state?.isAdminInit]);

  const handleTabChange = (tab: 'standings' | 'fixtures' | 'admin') => {
    if (tab !== activeTab) {
      setIsAddingDescription(false);
      setQuickDescription('');
      setActiveTab(tab);
    }
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (tournament && password === tournament.admin_password) {
      setIsAdminAuthenticated(true);
      localStorage.setItem(`admin_pw_${slug}`, password);
    } else {
      alert('Invalid password');
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
        })
        .eq('id', tournament?.id);

      if (error) throw error;
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

  const fetchTeamData = async (htId: string, isReplacement: boolean) => {
    if (!htId || htId.length < 6) return;
    setIsFetchingTeamData(true);
    try {
      const res = await fetch(`/api/teams/info?team_id=${htId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch team data');

      // Validation check
      const category = tournament?.league_category || 'male';
      const categoryName = category === 'hfi' ? 'Hattrick Femme International (HFI)' : 'Regular league (male)';
      const isFemaleLeague = data.teamName?.includes('Femme') || data.leagueId === 3000;
      const isMaleLeague = !isFemaleLeague;
      const teamCategory = isFemaleLeague ? 'HFI' : 'male league';

      if (category === 'hfi' && !isFemaleLeague) {
        throw new Error(`Team ID ${htId} "${data.teamName}" (${teamCategory}) is not eligible to play in a ${categoryName}. Please register a ${categoryName} team.`);
      }
      if (category === 'male' && !isMaleLeague) {
        throw new Error(`Team ID ${htId} "${data.teamName}" (${teamCategory}) is not eligible to play in a ${categoryName}. Please register a ${categoryName} team.`);
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
        'Cannot generate schedule: Too many inactive teams. Please replace or revive teams to meet the minimum quota.'
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
          neutralInSingle: true,
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
      4,
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
            <h1>{tournament.name}</h1>
            <p className={styles.subtitle}>
              Season {tournament.season}
              {tournament.status === 'finished' && <span> • Finished</span>}
            </p>
            {tournament.organizer_name && (
              <div className={styles.organizerInfo}>
                <span className={styles.organizerLabel}>Organizer:</span>
                <span className={styles.organizerName}>{tournament.organizer_name}</span>
              </div>
            )}
          </div>
          <div className={styles.headerActions}>
            <div className={styles.imagePlaceholder}>
              <span>260 x 210 Placeholder</span>
            </div>
          </div>
        </div>

        {isGenerated && !isHealthQuotaMet() && (
          <div className={styles.pauseNotice}>
            <Lineicons icon={QuestionMarkCircleOutlined} size={24} />
            <div>
              <h3>Tournament Paused</h3>
              <p>More than 25% of teams have become inactive. The tournament is paused until teams are revived or replaced.</p>
            </div>
          </div>
        )}

        {isJoining && (
          <div className={styles.registrationFormWrapper}>
            <Card variant="hero" title="Register Your Team">
              {isGenerated && (
                <p className={styles.registrationIntro}>
                  You are joining an ongoing tournament. You will fill an available spot.
                </p>
              )}
              <div className={styles.registrationLinkArea}>
                <Button
                  size="lg"
                  variant="primary"
                  onClick={() => (window.location.href = `/api/auth/init?tournament_id=${tournament?.id}`)}
                >
                  <Lineicons icon={HandShakeOutlined} size={20} /> Connect with Hattrick
                </Button>
                <p className={styles.registrationLinkNote}>
                  Recommended: Authorize HT-120min to fetch your team data and results automatically.
                </p>
              </div>

              <div className={styles.dividerWrapper}>
                <hr className={styles.dividerLine} />
                <span className={styles.dividerText}>
                  OR MANUAL ENTRY
                </span>
              </div>

              <form onSubmit={(e) => addTeam(e, true)} className={styles.joinForm}>
                <div className={styles.joinInputs}>
                  <input
                    type="text"
                    placeholder="HT Team ID"
                    value={joinTeamId}
                    onChange={(e) => setJoinTeamId(e.target.value.replace(/\D/g, ''))}
                    minLength={6}
                    maxLength={9}
                    required
                  />
                  <input
                    type="text"
                    placeholder="Team Name"
                    value={joinTeamName}
                    readOnly
                    className={styles.readOnlyName}
                    required
                  />
                </div>
                <div className={styles.joinActions}>
                  <Button type="submit" variant="secondary" disabled={isSavingTeam}>
                    {isSavingTeam ? 'Joining...' : 'Confirm Join'}
                  </Button>
                  <Button variant="outline" onClick={() => setIsJoining(false)} className={styles.mutedAction}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        <div className={styles.description}>
          {!tournament.description && isAdminAuthenticated && !isAddingDescription && (
            <button className={styles.addDescBtn} onClick={() => setIsAddingDescription(true)}>
              + Add description
            </button>
          )}

          {isAddingDescription && (
            <div className={styles.quickAddDesc}>
              <div className={adminStyles.labelRow}>
                <label>Add Description</label>
                <button type="button" onClick={() => regenerateDescription(true)} className={adminStyles.iconBtn}>
                  <Lineicons icon={RefreshCircle1ClockwiseOutlined} size={16} />
                </button>
              </div>
              <textarea
                value={quickDescription}
                onChange={(e) => setQuickDescription(e.target.value)}
                placeholder="Add tournament description..."
                rows={3}
                autoFocus
              />

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
          {/* user written descriptions: do not change */}
          {is120minMode ? (
            <div className={styles.scoringHelp}>
              <p>
                <strong>120min training mode</strong>{' '}
                <Lineicons
                  icon={QuestionMarkCircleOutlined}
                  size={19}
                  className={styles.helpIcon}
                  onClick={() => setShowScoringHelp(!showScoringHelp)}
                />
              </p>
              {showScoringHelp && (
                <p className={styles.helpContent}>
                  Teams in this tournament compete to score more 120min training matches achieved than their opponents.
                  Standings are ranked by <strong>120min achievements</strong> primarily. Ties are settled by{' '}
                  <strong>Total Minutes</strong> (means more training minutes achieved), then{' '}
                  <strong>Smaller Goal Difference</strong> (here closer means better), and finally{' '}
                  <strong>Goals Scored</strong> (means draws with fireworks).
                </p>
              )}
            </div>
          ) : (
            <div className={styles.scoringHelp}>
              <p>
                <strong>Victory points mode</strong>{' '}
                <Lineicons
                  icon={QuestionMarkCircleOutlined}
                  size={16}
                  className={styles.helpIcon}
                  onClick={() => setShowScoringHelp(!showScoringHelp)}
                />
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

          {!isGenerated && (
            <div className={styles.registrationStatus}>
              <p>
                <strong>Registration mode</strong>
              </p>
              <div className={styles.helpContent}>
                <p>This tournament is in registration mode, you're free to register.</p>
                {!isJoining && (
                  <Button onClick={() => setIsJoining(true)} variant="primary" size="sm" className={styles.topSpacing}>
                    <Lineicons icon={EnterOutlined} size={14} /> Join Tournament
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.tabs}>
        <button className={activeTab === 'standings' ? styles.active : ''} onClick={() => handleTabChange('standings')}>
          Standings
        </button>
        <button className={activeTab === 'fixtures' ? styles.active : ''} onClick={() => handleTabChange('fixtures')}>
          Fixtures & Results
        </button>
        <button className={activeTab === 'admin' ? styles.active : ''} onClick={() => handleTabChange('admin')}>
          Admin
        </button>
      </div>

      {activeTab === 'standings' && (
        <Card title="🏆 Standings" variant="classic" headerThumbnailIndex={tournament.thumbnail_index}>
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
                {standings.map((s, idx) => (
                  <tr key={s.teamId}>
                    <td className={styles.muted}>{idx + 1}</td>
                    <td className={styles.teamNameCell}>
                      <div className={styles.teamInfo}>
                        <div className={styles.nameRow}>
                          <span className={styles.teamName}>{s.teamName}</span>
                          {s.joinedViaOauth && (
                            <span title="Hattrick Validated Team">
                              <Lineicons icon={CheckOutlined} size={14} style={{ color: '#0fb54c' }} />
                            </span>
                          )}
                          <a
                            href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${s.htTeamId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.htLink}
                          >
                            <Lineicons icon={Link2AngularRightOutlined} size={12} />
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
                ))}

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
                            <Button variant="zero" size="sm" onClick={handleInvite} className={styles.inviteSpotBtn} style={{ padding: 0 }}>
                              <Lineicons icon={PlusOutlined} size={14} /> Invite
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
            <div style={{ marginTop: '2rem', textAlign: 'center' }}>
              <p style={{ fontStyle: 'italic', opacity: 0.8, marginBottom: '1rem' }}>
                {isGenerated ? (
                  teams.some((t) => !t.active)
                    ? `${
                        teams.filter((t) => !t.active).length
                      } team(s) have become inactive and their spots can be filled by another team.`
                    : "An odd number of teams means there's a BYE spot available for a new team to join."
                ) : (
                  'This tournament is still open for registration, you can invite someone to join.'
                )}
              </p>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'fixtures' && (
        <div className={styles.rounds}>
          {!isGenerated ? (
            <Card variant="classic">
              <div className={styles.openMessage}>
                <h2>Registration Open</h2>
                <p>This tournament is still open for registration, you can invite someone to join.</p>
              </div>
            </Card>
          ) : (
            <>
              {rounds.slice(0, visibleRoundsCount).map((round) => (
                <Card key={round.id} title={`Round ${round.round_number}`} variant="classic">
                  <div className={styles.matches}>
                    {round.matches.map((match: any) => (
                      <div key={match.id} className={styles.match}>
                        <div className={styles.matchTeams}>
                          <TeamDisplay team={match.home_team} side="home" />
                          <span className={styles.vs}>vs</span>
                          <TeamDisplay team={match.away_team} side="away" />
                        </div>
                        <div className={styles.result}>
                          {match.completed ? (
                            <div className={styles.scoreRow}>
                              <span className={styles.score}>
                                {match.home_goals} - {match.away_goals}
                              </span>
                              {match.went_120 && <span className={styles.badge}>120min</span>}
                            </div>
                          ) : (
                            <span className={styles.pending}>Scheduled</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
              {visibleRoundsCount < rounds.length && (
                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                  <Button onClick={() => setVisibleRoundsCount((prev) => prev + 4)} variant="outline">
                    Show More
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'admin' && (
        <div className={styles.adminSection}>
          {!isAdminAuthenticated ? (
            <Card variant="classic" title="Admin Access">
              <form onSubmit={handleAdminLogin} className={styles.adminAuthForm}>
                <div className={styles.authField}>
                  <label>Tournament Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter admin password"
                    required
                  />
                </div>
                <Button type="submit" variant="primary" size="lg">
                  <Lineicons icon={Shield2CheckOutlined} size={18} /> Authenticate
                </Button>
              </form>
            </Card>
          ) : (
            <div className={adminStyles.admin}>
              <div className={adminStyles.mainGrid}>
                <section className={adminStyles.teamsSection}>
                  <Card
                    title="Tournament Settings"
                    variant="classic"
                    collapsible
                    isCollapsed={isSettingsCollapsed}
                    onToggleCollapse={() => setIsSettingsCollapsed(!isSettingsCollapsed)}
                  >
                    <div className={adminStyles.settingsGroup} style={{ marginBottom: '1.5rem' }}>
                      {/* <div className={adminStyles.field} style={{ marginBottom: '1.5rem' }}>
                        <div className={adminStyles.labelRow}>
                          <label>Tournament Name</label>
                          <button type="button" onClick={regenerateName} className={adminStyles.iconBtn}>
                            <Lineicons icon={RefreshCircle1ClockwiseOutlined} size={16} />
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
                            <Lineicons icon={CopyAiOutlined} size={isMobile ? 10 : 14} />
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
                            <Lineicons icon={CopyAiOutlined} size={10} />
                          </Button>
                        </div>
                      </div>

                      <div className={adminStyles.field}>
                        <label>Tournament Category</label>
                        <select
                          value={editLeagueCategory}
                          onChange={(e) => setEditLeagueCategory(e.target.value as any)}
                          disabled={teams.length > 0 && !isSuperAdmin}
                          style={{ width: '100%', padding: '0.75rem', borderRadius: '6px' }}
                        >
                          <option value="male">Regular league (male)</option>
                          <option value="hfi">Hattrick Femme International (HFI)</option>
                        </select>
                        {teams.length > 0 && !isSuperAdmin && (
                          <p style={{ fontSize: '0.8rem', marginTop: '0.4rem', opacity: 0.8 }}>
                            Category is locked once teams have registered.
                          </p>
                        )}
                      </div>

                      <div className={adminStyles.field}>
                        <label>Registration Type</label>
                        <select
                          value={editRegistrationType}
                          onChange={(e) => setEditRegistrationType(e.target.value as any)}
                          disabled={teams.length > 0 && !isSuperAdmin}
                          style={{ width: '100%', padding: '0.75rem', borderRadius: '6px' }}
                        >
                          <option value="validated">Hattrick Validated (CHPP)</option>
                          <option value="manual">Organizer-Managed</option>
                        </select>
                      </div>

                      {isSuperAdmin && (
                        <div className={adminStyles.checkboxField}>
                          <label className={adminStyles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={isTest}
                              onChange={(e) => setIsTest(e.target.checked)}
                            />
                            Testing Ground (Super-Admin only)
                          </label>
                        </div>
                      )}

                      <div className={adminStyles.field}>
                        <label>League of team (any by default)</label>
                        <select
                          value={editCountryLimit || ''}
                          onChange={(e) => setEditCountryLimit(e.target.value || null)}
                          style={{ width: '100%', padding: '0.75rem', borderRadius: '6px' }}
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
                              <p style={{ fontSize: '0.8rem', marginTop: '0.4rem', opacity: 0.8 }}>
                                teams from at least 2 leagues already registered
                              </p>
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

                      <div className={adminStyles.checkboxField} style={{ marginBottom: '1rem' }}>
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
                              >
                                <Lineicons icon={RefreshCircle1ClockwiseOutlined} size={16} />
                              </button>
                            )}
                          </div>
                        </div>

                        {showEditDescription && (
                          <div className={adminStyles.textField} style={{ marginTop: '1rem' }}>
                            <textarea
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              placeholder="Tournament description..."
                              rows={4}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <Button onClick={updateSettings} disabled={isUpdatingSettings} variant="primary" size="sm">
                      {isUpdatingSettings ? 'Saving...' : 'Save Settings'}
                    </Button>
                  </Card>

                  <Card
                    title="Manage Teams & Schedule"
                    variant="classic"
                    collapsible
                    isCollapsed={isTeamsCollapsed}
                    onToggleCollapse={() => {
                      const newState = !isTeamsCollapsed;
                      setIsTeamsCollapsed(newState);
                      localStorage.setItem(`teams_collapsed_${slug}`, JSON.stringify(newState));
                    }}
                  >
                    {(!isGenerated || teams.some((t) => !t.active) || teams.length % 2 !== 0) && (
                      <div className={adminStyles.addTeamSection}>
                        <h3 className={adminStyles.sectionTitle}>
                          {tournament.registration_type === 'validated' ? 'Invite Team' : 'Add Team'}
                        </h3>
                        {tournament.registration_type === 'validated' && (
                          <p style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '1rem' }}>
                            In a self-validated tournament, you can't add teams manually. Use this tool to get team data and then send them an invitation.
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
                              style={{ pointerEvents: 'none', opacity: newTeamName ? 1 : 0.6 }}
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
                              <Lineicons icon={HandShakeOutlined} size={18} />{' '}
                              {isFetchingTeamData ? 'Fetching...' : 'Get team data'}
                            </Button>
                          )}
                          {newTeamName && (
                            <>
                              {tournament.registration_type === 'validated' ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
                                  <textarea
                                    readOnly
                                    style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '0.5rem', color: 'var(--text)', padding: '0.5rem', fontSize: '0.85rem', minHeight: '60px', resize: 'none' }}
                                    value={`Join our tournament "${tournament.name}" on HT-120min! We have a spot for ${newTeamName}. Register here: ${publicUrl}`}
                                  />
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => {
                                      navigator.clipboard.writeText(`Join our tournament "${tournament.name}" on HT-120min! We have a spot for ${newTeamName}. Register here: ${publicUrl}`);
                                      alert('Invitation template for ' + newTeamName + ' copied!');
                                    }}
                                  >
                                    <Lineicons icon={CopyAiOutlined} size={18} /> Copy Invite for {newTeamName}
                                  </Button>
                                </div>
                              ) : (
                                <Button type="submit" disabled={isSavingTeam} variant="primary">
                                  {isSavingTeam ? (
                                    'Saving...'
                                  ) : (
                                    <>
                                      <Lineicons icon={PlusOutlined} size={18} /> Add {newTeamName}
                                    </>
                                  )}
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
                              {team.joined_via_oauth && (
                                <span title="Hattrick Validated Team">
                                  <Lineicons icon={CheckOutlined} size={14} style={{ color: '#0fb54c' }} />
                                </span>
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
                                      }}
                                      required
                                    />
                                    <input
                                      name={`replace_name_${team.id}`}
                                      type="text"
                                      placeholder="New Name"
                                      value={replacementName}
                                      readOnly
                                      style={{ pointerEvents: 'none', opacity: replacementName ? 1 : 0.6 }}
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
                                          <Lineicons icon={HandShakeOutlined} size={14} /> Get data
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
                                        <Lineicons icon={XmarkOutlined} size={16} />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button size="sm" variant="zero" onClick={() => setReplacingTeamId(team.id)}>
                                    <Lineicons icon={RefreshCircle1ClockwiseOutlined} size={14} /> Replace
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
                                  <Lineicons icon={Trash3Outlined} size={16} />
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
                                      style={{ pointerEvents: 'none', opacity: replacementName ? 1 : 0.6 }}
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
                                          <Lineicons icon={HandShakeOutlined} size={14} /> Get data
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
                                        <Lineicons icon={XmarkOutlined} size={16} />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button size="sm" variant="zero" onClick={() => setReplacingTeamId(team.id)}>
                                    <Lineicons icon={RefreshCircle1ClockwiseOutlined} size={14} /> Replace
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className={adminStyles.inviteTemplate}>
                      <label>Hattrick Invitation Template</label>
                      <div className={adminStyles.templateBox}>
                        <textarea
                          readOnly
                          value={`Join our tournament "${tournament.name}" (Season ${tournament.season}) on HT-120min! Register your team here: ${publicUrl}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(`Join our tournament "${tournament.name}" (Season ${tournament.season}) on HT-120min! Register your team here: ${publicUrl}`);
                            alert('Invitation copied!');
                          }}
                        >
                          <Lineicons icon={CopyAiOutlined} size={14} /> Copy
                        </Button>
                      </div>
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
                          >
                            <Lineicons icon={PlayOutlined} size={18} /> Generate Schedule
                          </Button>
                          <p className="center w-100">Generating schedule will also close registration. </p>
                        </div>
                      ) : (
                        <div className={adminStyles.genActions}>
                          <Button variant="outline" onClick={regenerateSchedule} disabled={isGenerating} fullWidth>
                            <Lineicons icon={RefreshCircle1ClockwiseOutlined} size={18} />
                            Reset and Re-open
                          </Button>
                          {scheduleMode === 'recurring' && (
                            <Button
                              variant="outline"
                              onClick={generateMoreRounds}
                              disabled={isGenerating}
                              fullWidth
                              style={{ marginTop: '0.5rem' }}
                            >
                              {isGenerating ? 'Generating...' : 'Generate more rounds'}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                </section>

                {isGenerated && (
                  <section className={adminStyles.fixturesSection}>
                    <div className={adminStyles.fixturesHeader}>
                      <h2>Results Entry</h2>
                    </div>
                    {rounds.map((round) => (
                      <Card key={round.id} title={`Round ${round.round_number}`} variant="classic">
                        <div className={adminStyles.matches}>
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
                                      >
                                        <Lineicons icon={FloppyDisk1Outlined} size={18} />
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="danger"
                                        title="Clear result"
                                        onClick={() => {
                                          if (window.confirm('Clear result for this match?')) {
                                            updateMatch(match.id, true);
                                          }
                                        }}
                                      >
                                        <Lineicons icon={Trash3Outlined} size={16} />
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={() => setEditingMatch(null)}
                                        title="Cancel"
                                      >
                                        <Lineicons icon={XmarkOutlined} size={18} />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className={adminStyles.matchResult}>
                                    {match.completed ? (
                                      <div className={adminStyles.resultInfo}>
                                        <span className={adminStyles.score}>
                                          {match.home_goals} - {match.away_goals}
                                        </span>
                                        {match.went_120 && <span className={adminStyles.badge}>120min</span>}
                                        {tournament.registration_type === 'Organizer-Managed' && (
                                          <Button
                                            size="xs"
                                            variant="outline"
                                            onClick={() => {
                                              setEditingMatch(match.id);
                                              setMatchData({ ...matchData, [match.id]: match });
                                            }}
                                          >
                                            Edit
                                          </Button>
                                        )}
                                      </div>
                                    ) : (
                                      tournament.registration_type === 'Organizer-Managed' && (
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
                                        >
                                          Enter Result
                                        </Button>
                                      )
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    ))}
                  </section>
                )}
              </div>

              <div className={adminStyles.footerActions}>
                <Button variant="outline" size="sm" onClick={() => window.confirm('Pause this tournament?')}>
                   Pause Tournament
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.confirm('Archive this tournament? (Only if seasons finished)')}>
                   Archive Tournament
                </Button>
                <Button variant="danger" size="sm" onClick={() => window.confirm('Permanently DELETE this tournament? This cannot be undone!')}>
                   Delete Tournament
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
