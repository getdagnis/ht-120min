import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getTournamentNextMatchDate } from '../utils/tournament-next-match';
import { sortFeaturedFirst } from '../utils/tournament-sorting';
import { clearMainAuthSession } from '../utils/auth-storage';

export interface AvatarLayer {
  x?: number;
  y?: number;
  image: string;
}

export interface Avatar {
  backgroundImage: string;
  layers: AvatarLayer[];
}

export interface HattrickTeam {
  teamId: number;
  teamName: string;
  countryName: string;
  leagueId: number;
}

export interface UserProfile {
  hattrick_user_id: number;
  manager_name: string;
  country_id?: number;
  country_name?: string;
  league_id?: number;
  avatar_json?: Avatar;
  teams_json?: HattrickTeam[];
  created_at: string;
}

export interface ActiveTournament {
  id: string;
  name: string;
  slug: string;
  is_featured: boolean;
  created_at: string;
  nextMatchDate: Date | null;
}

export interface FinishedTournament {
  id: string;
  name: string;
  slug: string;
  is_featured: boolean;
  created_at: string;
}

export interface OrganizerTournament {
  id: string;
  name: string;
  slug: string;
  is_featured: boolean;
  status: string | null;
  created_at: string;
}

export interface TestTournament {
  id: string;
  name: string;
  slug: string;
  is_featured: boolean;
  status: string | null;
  created_at: string;
}

interface DBTeamMatch {
  id: string;
  completed: boolean;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team: { country_name: string } | null;
}

interface DBRound {
  id: string;
  created_at: string;
  round_number: number;
  season_number?: number | null;
  matches: DBTeamMatch[] | null;
}

interface DBTournament {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  is_featured?: boolean | null;
  status?: string | null;
  is_archived?: boolean | null;
  is_test?: boolean | null;
  registration_type?: string | null;
  season?: number | null;
  rounds: DBRound[] | null;
}

interface DBTeamJoin {
  tournament_id: string;
  tournaments: DBTournament | null;
}

interface DBOrganizerTournament {
  id: string;
  name: string;
  slug: string;
  is_featured?: boolean | null;
  status: string | null;
  is_archived?: boolean | null;
  is_test?: boolean | null;
  registration_type?: string | null;
  created_at: string;
}

interface DBWarning {
  round_id: string;
  team_id: string;
}

export const useAuth = () => {
  const [managerName, setManagerName] = useState<string | null>(localStorage.getItem('my_ht_manager_name'));
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTournaments, setActiveTournaments] = useState<ActiveTournament[]>([]);
  const [finishedTournaments, setFinishedTournaments] = useState<FinishedTournament[]>([]);
  const [organizerTournaments, setOrganizerTournaments] = useState<OrganizerTournament[]>([]);
  const [testTournaments, setTestTournaments] = useState<TestTournament[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProfile = useCallback(async (uid: number) => {
    setLoading(true);
    try {
      // 1. Fetch Profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('hattrick_user_id', uid)
        .maybeSingle();

      if (profileData) {
        setProfile(profileData as UserProfile);
        if (profileData.manager_name !== managerName) {
          setManagerName(profileData.manager_name);
          localStorage.setItem('my_ht_manager_name', profileData.manager_name);
        }
      }

      // 2. Fetch Active Tournaments for the user
      const { data: teamsDataRaw } = await supabase
        .from('teams')
        .select(`
          tournament_id, 
          tournaments (
            id, 
            name, 
            slug, 
            created_at,
            is_featured,
            status,
            is_archived,
            is_test,
            registration_type,
            season,
            rounds (
              id,
              created_at,
              round_number,
              season_number,
              matches (
                id,
                completed,
                status,
                home_team_id,
                away_team_id,
                scheduled_for,
                home_team:teams!matches_home_team_id_fkey(country_name)
              )
            )
          )
        `)
        .eq('hattrick_user_id', uid)
        .eq('active', true);

      const teamsData = teamsDataRaw as unknown as DBTeamJoin[] | null;

      const tournamentIds = Array.from(new Set((teamsData ?? []).map((t) => t.tournament_id).filter(Boolean)));
      let warnings: DBWarning[] | null = null;
      if (tournamentIds.length > 0) {
        const { data: warningsRaw } = await supabase
          .from('fixture_warnings')
          .select('round_id, team_id')
          .in('tournament_id', tournamentIds)
          .eq('active', true);

        warnings = warningsRaw as unknown as DBWarning[] | null;
      }

      const toursMap = new Map<string, ActiveTournament>();
      const finishedToursMap = new Map<string, FinishedTournament>();

      for (const t of teamsData ?? []) {
        const tournament = t.tournaments;
        if (!tournament) continue;
        if (
          tournament.status === 'stopped' ||
          tournament.status === 'archived' ||
          tournament.is_archived ||
          tournament.is_test ||
          tournament.registration_type === 'sandbox'
        ) {
          continue;
        }

        if (tournament.status === 'finished') {
          finishedToursMap.set(tournament.id, {
            id: tournament.id,
            name: tournament.name,
            slug: tournament.slug,
            is_featured: Boolean(tournament.is_featured),
            created_at: tournament.created_at,
          });
          continue;
        }

        toursMap.set(tournament.id, {
          id: tournament.id,
          name: tournament.name,
          slug: tournament.slug,
          is_featured: Boolean(tournament.is_featured),
          created_at: tournament.created_at,
          nextMatchDate: getTournamentNextMatchDate(
            (tournament.rounds ?? []).filter(
              (round) => (round.season_number ?? tournament.season ?? 1) === (tournament.season ?? 1),
            ),
            warnings,
          ),
        });
      }

      const sortedTours = sortFeaturedFirst(Array.from(toursMap.values()), (a, b) => {
        if (!a.nextMatchDate && !b.nextMatchDate) return 0;
        if (!a.nextMatchDate) return 1; // Far future
        if (!b.nextMatchDate) return -1;
        return a.nextMatchDate.getTime() - b.nextMatchDate.getTime();
      });

      setActiveTournaments(sortedTours);
      setFinishedTournaments(
        sortFeaturedFirst(Array.from(finishedToursMap.values()), (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
      );

      const { data: organizerDataRaw } = await supabase
        .from('tournaments')
        .select('id, name, slug, status, is_archived, is_test, registration_type, created_at, is_featured')
        .eq('organizer_id', uid)
        .neq('status', 'archived')
        .order('created_at', { ascending: false });

      const organizerRows = ((organizerDataRaw as unknown as DBOrganizerTournament[] | null) ?? []).filter(
        (tournament) => tournament.status !== 'archived' && !tournament.is_archived,
      );

      const mapMenuTournament = (tournament: DBOrganizerTournament) => ({
        id: tournament.id,
        name: tournament.name,
        slug: tournament.slug,
        is_featured: Boolean(tournament.is_featured),
        status: tournament.status,
        created_at: tournament.created_at,
      });

      const testTours = organizerRows
        .filter((tournament) => tournament.registration_type === 'sandbox' || tournament.is_test)
        .map(mapMenuTournament);

      const organizerTours = organizerRows
        .filter((tournament) => tournament.registration_type !== 'sandbox' && !tournament.is_test)
        .map((tournament) => ({
          id: tournament.id,
          name: tournament.name,
          slug: tournament.slug,
          is_featured: Boolean(tournament.is_featured),
          status: tournament.status,
          created_at: tournament.created_at,
        }));

      setOrganizerTournaments(
        sortFeaturedFirst(organizerTours, (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      );
      setTestTournaments(
        sortFeaturedFirst(testTours, (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      );
    } catch (err) {
      console.error('Error fetching profile:', err);
    } finally {
      setLoading(false);
    }
  }, [managerName]);

  useEffect(() => {
    const hattrickUserId = localStorage.getItem('my_ht_user_id') ? Number(localStorage.getItem('my_ht_user_id')) : null;
    if (hattrickUserId) {
      const timer = setTimeout(() => {
        void fetchProfile(hattrickUserId);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [fetchProfile]);

  const logout = () => {
    clearMainAuthSession();
    setManagerName(null);
    setProfile(null);
    setActiveTournaments([]);
    setFinishedTournaments([]);
    setOrganizerTournaments([]);
    setTestTournaments([]);
  };

  return {
    managerName,
    profile,
    activeTournaments,
    finishedTournaments,
    organizerTournaments,
    testTournaments,
    loading,
    logout,
    refreshProfile: () => {
      const uid = localStorage.getItem('my_ht_user_id');
      if (uid) void fetchProfile(Number(uid));
    },
  };
};
