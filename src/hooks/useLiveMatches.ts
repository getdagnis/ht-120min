import { useState, useEffect, useRef } from 'react';
import type { MatchEventDetails } from '../../shared/match-events';

export interface LiveMatchData {
  status: 'arranged' | 'ongoing' | 'finished';
  homeGoals: number;
  awayGoals: number;
  total_minutes?: number;
  went_120?: boolean;
  venue_mismatch?: boolean;
  home_yellow_cards?: number;
  home_red_cards?: number;
  home_injuries?: number;
  away_yellow_cards?: number;
  away_red_cards?: number;
  away_injuries?: number;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  appg_outcome?: 'ET3' | 'ET2' | 'PS1' | 'RT0' | 'OPW' | 'needs_review';
  appg_outcome_source?: 'unclassified' | 'chpp';
  match_event_details?: MatchEventDetails;
}

interface Match {
  completed: boolean;
  ht_match_id: number | null;
  status: string;
  match_date?: Date | string;
  appg_outcome?: 'ET3' | 'ET2' | 'PS1' | 'RT0' | 'OPW' | 'needs_review' | null;
  appg_outcome_source?: 'unclassified' | 'chpp' | 'organizer' | 'csv' | null;
}

export function useLiveMatches(
  tournamentId: string | undefined,
  matches: Match[],
  onMatchFinished?: () => void,
  enabled = true,
  reclassifyAppg = false,
) {
  const [liveData, setLiveData] = useState<Record<string, LiveMatchData>>({});

  const matchesRef = useRef(matches);
  const tournamentIdRef = useRef(tournamentId);
  const onMatchFinishedRef = useRef(onMatchFinished);
  const attemptedAppgMatchIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    attemptedAppgMatchIdsRef.current.clear();
  }, [tournamentId]);

  useEffect(() => {
    matchesRef.current = matches;
    tournamentIdRef.current = tournamentId;
    onMatchFinishedRef.current = onMatchFinished;
  }, [matches, tournamentId, onMatchFinished]);

  useEffect(() => {
    if (!tournamentId || !enabled) return;

    const checkLiveMatches = async () => {
      const now = new Date();
      const currentMatches = matchesRef.current;
      const currentTid = tournamentIdRef.current;

      if (!currentTid || !currentMatches || currentMatches.length === 0) return;

      const potentialLive = currentMatches.filter((m) => {
        if (!m.ht_match_id) return false;
        if (m.completed) {
          return (
            reclassifyAppg &&
            m.appg_outcome === 'needs_review' &&
            m.appg_outcome_source !== 'organizer' &&
            m.appg_outcome_source !== 'csv' &&
            !attemptedAppgMatchIdsRef.current.has(m.ht_match_id)
          );
        }
        if (!['arranged', 'ongoing', 'finished'].includes(m.status)) return false;
        const matchDate = m.match_date ? new Date(m.match_date) : null;
        if (!matchDate) return false;
        const startsAt = matchDate.getTime() - 5 * 60 * 1000;
        const endsAt = matchDate.getTime() + 4 * 60 * 60 * 1000;
        return now.getTime() >= startsAt && now.getTime() <= endsAt;
      });

      if (potentialLive.length === 0) return;

      const ids = potentialLive.map((m) => m.ht_match_id).join(',');
      try {
        const res = await fetch(`/api/chpp/live-matches?tournament_id=${currentTid}&match_ids=${ids}&_t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          potentialLive
            .filter((match) => match.completed && match.ht_match_id)
            .forEach((match) => attemptedAppgMatchIdsRef.current.add(match.ht_match_id!));

          let hasNewFinished = false;
          setLiveData((prev) => {
            const next = { ...prev };

            Object.entries(data.results as Record<string, LiveMatchData>).forEach(([id, result]) => {
              if (
                !next[id] ||
                next[id].homeGoals !== result.homeGoals ||
                next[id].awayGoals !== result.awayGoals ||
                next[id].status !== result.status
              ) {
                next[id] = result;
                if (result.status === 'finished') hasNewFinished = true;
              }
            });

            return next;
          });

          if (hasNewFinished) onMatchFinishedRef.current?.();

        }
      } catch (error) {
        console.error('Error polling live matches:', error);
      }
    };

    checkLiveMatches();
    const interval = setInterval(checkLiveMatches, 30000);
    return () => clearInterval(interval);
  }, [tournamentId, enabled, reclassifyAppg]);

  return { liveData };
}
