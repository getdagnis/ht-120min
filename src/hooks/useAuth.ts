import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { calculateMatchDate } from '../utils/ht-data';

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
  avatar_json?: Avatar;
  teams_json?: HattrickTeam[];
  created_at: string;
}

export interface ActiveTournament {
  id: string;
  name: string;
  slug: string;
  nextMatchDate: Date | null;
}

interface DBTeamMatch {
  id: string;
  completed: boolean;
  home_team_id: string;
  away_team_id: string;
  home_team: { country_name: string } | null;
}

interface DBRound {
  id: string;
  round_number: number;
  matches: DBTeamMatch[] | null;
}

interface DBTournament {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  rounds: DBRound[] | null;
}

interface DBTeamJoin {
  tournament_id: string;
  tournaments: DBTournament | null;
}

interface DBWarning {
  round_id: string;
  team_id: string;
}

export const useAuth = () => {
  const [managerName, setManagerName] = useState<string | null>(localStorage.getItem('my_ht_manager_name'));
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTournaments, setActiveTournaments] = useState<ActiveTournament[]>([]);
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
            rounds (
              id,
              round_number,
              matches (
                id,
                completed,
                home_team_id,
                away_team_id,
                home_team:teams!matches_home_team_id_fkey(country_name)
              )
            )
          )
        `)
        .eq('hattrick_user_id', uid)
        .eq('active', true);

      const teamsData = teamsDataRaw as unknown as DBTeamJoin[] | null;

      if (teamsData) {
        const tournamentIds = Array.from(new Set(teamsData.map((t) => t.tournament_id).filter(Boolean)));
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

        for (const t of teamsData) {
          const tournament = t.tournaments;
          if (!tournament) continue;

          // Find the earliest uncompleted match date
          let nextMatchDate: Date | null = null;
          
          if (tournament.rounds && tournament.rounds.length > 0) {
            const sortedRounds = [...tournament.rounds].sort((a, b) => a.round_number - b.round_number);
            
            for (const round of sortedRounds) {
              const uncompletedMatches = round.matches?.filter((m: DBTeamMatch) => !m.completed) ?? [];
              
              // Filter out misarranged matches (check both home and away)
              const validMatches = uncompletedMatches.filter(m => 
                !warnings?.some(w => w.round_id === round.id && 
                  (w.team_id === m.home_team_id || w.team_id === m.away_team_id))
              );

              if (validMatches.length > 0) {
                const date = calculateMatchDate(
                  tournament.created_at, 
                  round.round_number, 
                  validMatches[0].home_team?.country_name
                );
                nextMatchDate = date;
                break; 
              }
            }
          }

          toursMap.set(tournament.id, {
            id: tournament.id,
            name: tournament.name,
            slug: tournament.slug,
            nextMatchDate
          });
        }

        const sortedTours = Array.from(toursMap.values()).sort((a, b) => {
          if (!a.nextMatchDate && !b.nextMatchDate) return 0;
          if (!a.nextMatchDate) return 1; // Far future
          if (!b.nextMatchDate) return -1;
          return a.nextMatchDate.getTime() - b.nextMatchDate.getTime();
        });

        setActiveTournaments(sortedTours);
      }
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
    localStorage.removeItem('my_ht_manager_name');
    localStorage.removeItem('my_ht_user_id');
    localStorage.removeItem('my_ht_team_name');
    setManagerName(null);
    setProfile(null);
    setActiveTournaments([]);
  };

  return {
    managerName,
    profile,
    activeTournaments,
    loading,
    logout,
    refreshProfile: () => {
      const uid = localStorage.getItem('my_ht_user_id');
      if (uid) void fetchProfile(Number(uid));
    },
  };
};
