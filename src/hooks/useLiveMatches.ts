import { useState, useEffect, useRef } from 'react';
import type { MatchEventDetails } from '../../shared/match-events';
import { getLivePollDelay, type LivePollCandidate } from '../../shared/live-match';

export interface LiveMatchData extends Partial<LiveMatchClock> {
  status: 'arranged' | 'ongoing' | 'finished';
  homeGoals: number;
  awayGoals: number;
  total_minutes?: number | null;
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

export function mergeLiveMatchData(
  previous: Record<string, LiveMatchData>,
  current: Record<string, LiveMatchData>,
): Record<string, LiveMatchData> {
  return { ...previous, ...current };
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
  const notifiedFinishedMatchIdsRef = useRef<Set<string>>(new Set());
  const liveDataRef = useRef<Record<string, LiveMatchData>>({});

  useEffect(() => {
    attemptedAppgMatchIdsRef.current.clear();
    notifiedFinishedMatchIdsRef.current.clear();
    liveDataRef.current = {};
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

          const results = data.results as Record<string, LiveMatchData>;
          let newlyFinished = false;
          for (const [id, result] of Object.entries(results)) {
            if (result.status !== 'finished' || notifiedFinishedMatchIdsRef.current.has(id)) continue;
            notifiedFinishedMatchIdsRef.current.add(id);
            newlyFinished = true;
          }
          if (Object.keys(results).length > 0) {
            setLiveData((prev) => {
              const merged = mergeLiveMatchData(prev, results);
              liveDataRef.current = merged;
              return merged;
            });
          }
          if (newlyFinished) onMatchFinishedRef.current?.();

        }
      } catch (error) {
        console.error('Error polling live matches:', error);
      }
    };

    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      await checkLiveMatches();
      if (cancelled) return;
      const activeClock = currentMatchesForPolling(matchesRef.current, liveDataRef.current);
      timer = window.setTimeout(run, getLivePollDelay(activeClock));
    };
    void run();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [tournamentId, enabled, reclassifyAppg]);

  return { liveData };
}

function currentMatchesForPolling(
  matches: Match[],
  liveData: Record<string, LiveMatchData>,
): LivePollCandidate[] {
  return matches
    .filter((match) => match.ht_match_id && liveData[String(match.ht_match_id)]?.status === 'ongoing')
    .map((match) => ({
      ...liveData[String(match.ht_match_id!)],
      kickoffMs: match.match_date ? new Date(match.match_date).getTime() : null,
    }));
}
