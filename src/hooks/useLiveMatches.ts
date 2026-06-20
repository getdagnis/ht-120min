import { useState, useEffect, useRef } from 'react';

export interface LiveMatchData {
  status: 'ongoing' | 'finished';
  homeGoals: number;
  awayGoals: number;
  total_minutes?: number;
  went_120?: boolean;
  venue_mismatch?: boolean;
}

interface Match {
  completed: boolean;
  ht_match_id: number | null;
  status: string;
  match_date?: Date | string;
}

export function useLiveMatches(tournamentId: string | undefined, matches: Match[], onMatchFinished?: () => void) {
  const [liveData, setLiveData] = useState<Record<string, LiveMatchData>>({});
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const matchesRef = useRef(matches);
  const tournamentIdRef = useRef(tournamentId);
  const onMatchFinishedRef = useRef(onMatchFinished);

  useEffect(() => {
    matchesRef.current = matches;
    tournamentIdRef.current = tournamentId;
    onMatchFinishedRef.current = onMatchFinished;
  }, [matches, tournamentId, onMatchFinished]);

  useEffect(() => {
    if (!tournamentId) return;

    const checkLiveMatches = async () => {
      const now = new Date();
      const currentMatches = matchesRef.current;
      const currentTid = tournamentIdRef.current;

      if (!currentTid || !currentMatches || currentMatches.length === 0) return;

      const potentialLive = currentMatches.filter((m) => {
        if (m.completed) return false;
        if (!m.ht_match_id || m.status !== 'arranged') return false;
        const matchDate = m.match_date ? new Date(m.match_date) : null;
        return matchDate && now.getTime() >= matchDate.getTime() - 5 * 60 * 1000;
      });

      if (potentialLive.length === 0) return;

      const ids = potentialLive.map((m) => m.ht_match_id).join(',');
      try {
        const res = await fetch(`/api/chpp/live-matches?tournament_id=${currentTid}&match_ids=${ids}`);
        if (res.ok) {
          const data = await res.json();

          setLiveData((prev) => {
            const next = { ...prev };
            let hasNewFinished = false;

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

            if (hasNewFinished && onMatchFinishedRef.current) {
              onMatchFinishedRef.current();
            }
            return next;
          });

          setLastRefresh(data.lastRefresh);
        }
      } catch (error) {
        console.error('Error polling live matches:', error);
      }
    };

    checkLiveMatches();
    const interval = setInterval(checkLiveMatches, 30000);
    return () => clearInterval(interval);
  }, [tournamentId]);

  return { liveData, lastRefresh };
}
