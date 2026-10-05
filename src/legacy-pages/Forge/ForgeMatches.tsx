import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import styles from './ForgeMatches.module.sass';

interface TournamentOption {
  id: string;
  name: string;
  currentRoundNumber: number;
  matchCount: number;
}

interface RoundOption {
  roundNumber: number;
  fixtureCount: number;
  hasUnfinishedFixtures: boolean;
}

interface ForgeTeamView {
  side: 'home' | 'away';
  id: string;
  name: string;
  managerName: string | null;
  managerHtId: number | null;
  htTeamId: number | null;
  chppState: string;
  chppReason: string;
  canChallenge: boolean;
  canAccept: boolean;
  autoArrangeEnabled: boolean | null;
  challengeDisabledReason: string;
  acceptDisabledReason?: string;
}

interface ForgeFixtureView {
  id: string;
  status: string;
  completed: boolean;
  htMatchId: number | null;
  home: ForgeTeamView;
  away: ForgeTeamView;
}

interface MatchesResponse {
  tournaments?: TournamentOption[];
  tournament?: { id: string; name: string; season: number };
  currentRound?: { id: string; roundNumber: number; phase: string; phaseStatus: string } | null;
  roundOptions?: RoundOption[];
  fixtures?: ForgeFixtureView[];
  action?: { type: 'challenge' | 'accept'; message: string } | null;
  error?: string;
}

function stateIsDangerous(state: string) {
  return ['MISARRANGED', 'CHPP CREDENTIALS MISSING', 'CHPP PERMISSION MISSING', 'CHPP OWNERSHIP MISMATCH', 'CHPP ERROR'].includes(state);
}

export function ForgeMatchesSection() {
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [selectedRoundNumber, setSelectedRoundNumber] = useState<number | null>(null);
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyAction, setBusyAction] = useState('');

  const loadTournamentOptions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/forge/matches', { credentials: 'include' });
      const payload = (await response.json()) as MatchesResponse;
      if (!response.ok) throw new Error(payload.error || 'Could not load Forge tournaments.');
      setTournaments(payload.tournaments || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Forge tournaments.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async (tournamentId: string, roundNumber: number | null = null) => {
    if (!tournamentId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ tournamentId });
      if (roundNumber) params.set('roundNumber', String(roundNumber));
      const response = await fetch(`/api/forge/matches?${params.toString()}`, { credentials: 'include' });
      const payload = (await response.json()) as MatchesResponse;
      if (!response.ok) throw new Error(payload.error || 'Could not load tournament matches.');
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load tournament matches.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadTournamentOptions();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadTournamentOptions]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadMatches(selectedTournamentId, selectedRoundNumber);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadMatches, selectedRoundNumber, selectedTournamentId]);

  const runAction = async (fixture: ForgeFixtureView, team: ForgeTeamView, action: 'challenge' | 'accept') => {
    const opponent = team.side === 'home' ? fixture.away : fixture.home;
    const verb = action === 'challenge' ? 'Send' : 'Accept';
    const prompt = action === 'challenge'
      ? `Send a Cup Rules challenge from ${team.name} to ${opponent.name}?`
      : `Accept the pending challenge from ${opponent.name} for ${team.name}?`;
    if (!window.confirm(`${prompt}\n\nThis performs a real Hattrick action.`)) return;

    const actionKey = `${fixture.id}:${team.side}:${action}`;
    setBusyAction(actionKey);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/forge/matches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: selectedTournamentId,
          matchId: fixture.id,
          roundNumber: data?.currentRound?.roundNumber,
          actingSide: team.side,
          action,
        }),
      });
      const payload = (await response.json()) as MatchesResponse;
      if (!response.ok) throw new Error(payload.error || `${verb} action failed.`);
      setData(payload);

      let refreshNote = '';
      if (action === 'accept') {
        const refreshResponse = await fetch(`/api/teams/refresh-fixtures?tournament_id=${encodeURIComponent(selectedTournamentId)}`, {
          credentials: 'include',
        });
        if (!refreshResponse.ok) refreshNote = ' Local fixture refresh did not complete; reload or use Refresh Fixtures to reconcile it.';
        await loadMatches(selectedTournamentId, selectedRoundNumber || payload.currentRound?.roundNumber || null);
      } else {
        await loadMatches(selectedTournamentId, selectedRoundNumber || payload.currentRound?.roundNumber || null);
      }
      setMessage(`${payload.action?.message || `${verb} action completed.`}${refreshNote}`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${verb} action failed.`);
    } finally {
      setBusyAction('');
    }
  };

  return (
    <section className={styles.page}>
      <SectionCard title="Match booking" subtitle="Coordinate any materialized tournament round directly from its fixtures." className={styles.surfaceCard}>
        <div className={styles.toolbar}>
          <label className={styles.label} htmlFor="forge-matches-tournament">Tournament</label>
          <select
            id="forge-matches-tournament"
            className={styles.select}
            value={selectedTournamentId}
            onChange={(event) => {
              setSelectedTournamentId(event.target.value);
              setSelectedRoundNumber(null);
              setData(null);
              setMessage('');
              setError('');
            }}
          >
            <option value="">Choose a tournament</option>
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name}
              </option>
            ))}
          </select>
        </div>
        {!loading && !error && selectedTournamentId && data?.roundOptions && data.roundOptions.length > 0 && (
          <div className={styles.toolbar}>
            <label className={styles.label} htmlFor="forge-matches-round">Round</label>
            <select
              id="forge-matches-round"
              className={styles.select}
              value={selectedRoundNumber || data.currentRound?.roundNumber || ''}
              onChange={(event) => {
                const nextRoundNumber = Number(event.target.value);
                setSelectedRoundNumber(Number.isSafeInteger(nextRoundNumber) ? nextRoundNumber : null);
                setMessage('');
                setError('');
              }}
            >
              {data.roundOptions.map((round) => (
                <option key={round.roundNumber} value={round.roundNumber}>
                  Round {round.roundNumber} ({round.fixtureCount} matches)
                  {round.hasUnfinishedFixtures ? ' · unfinished' : ' · completed'}
                </option>
              ))}
            </select>
          </div>
        )}
        {loading && <p className={styles.empty}>Loading matches...</p>}
        {!loading && error && <p className={styles.error}>{error}</p>}
        {!loading && !error && !selectedTournamentId && <p className={styles.empty}>Choose a tournament to view its materialized rounds.</p>}
        {!loading && !error && selectedTournamentId && data?.currentRound && (
          <div>
            <div className={styles.roundHeading}>
              <h2 className={styles.roundTitle}>{data.tournament?.name}</h2>
              <span className={styles.roundMeta}>Round {data.currentRound.roundNumber}</span>
            </div>
            {message && <p className={styles.success}>{message}</p>}
            <div className={styles.fixtureList}>
              {(data.fixtures || []).map((fixture, index) => {
                const fixtureStatus = fixture.home.chppState === 'MISARRANGED' || fixture.away.chppState === 'MISARRANGED'
                  ? 'MISARRANGED'
                  : fixture.home.chppState === 'ARRANGED' || fixture.away.chppState === 'ARRANGED'
                    ? 'ARRANGED'
                    : 'NOT ARRANGED';
                return (
                  <article key={fixture.id} className={styles.fixture}>
                    <div className={styles.fixtureHeader}>
                      <span className={styles.fixtureNumber}>Match {index + 1}</span>
                      <span className={`${styles.fixtureStatus} ${fixtureStatus === 'MISARRANGED' ? styles.fixtureStatusDanger : ''}`}>
                        {fixtureStatus}
                      </span>
                    </div>
                    <div className={styles.fixtureTeams}>
                      {[fixture.home, fixture.away].map((team) => (
                        <div key={team.side} className={styles.teamRow}>
                          <div className={styles.teamIdentity}>
                            <div className={styles.teamName}>{team.name}</div>
                            <div className={styles.managerName}>{team.managerName || 'Manager unavailable'}</div>
                          </div>
                          <div className={styles.stateRow}>
                            <span className={`${styles.stateBadge} ${stateIsDangerous(team.chppState) ? styles.stateBadgeDanger : ''}`}>
                              {team.chppState}
                            </span>
                            {team.autoArrangeEnabled !== null && (
                              <span className={`${styles.stateBadge} ${team.autoArrangeEnabled ? styles.autoArrangeEnabled : styles.autoArrangeDisabled}`}>
                                AUTO-ARRANGE {team.autoArrangeEnabled ? 'ON' : 'OFF'}
                              </span>
                            )}
                          </div>
                          <p className={styles.stateReason}>{team.chppReason}</p>
                          <div className={styles.actions}>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!team.canChallenge || Boolean(busyAction)}
                              title={team.canChallenge ? `Send a Cup Rules challenge to ${team.side === 'home' ? fixture.away.name : fixture.home.name}` : team.challengeDisabledReason}
                              onClick={() => void runAction(fixture, team, 'challenge')}
                            >
                              Challenge {team.side === 'home' ? fixture.away.name : fixture.home.name}
                            </Button>
                            <Button
                              variant="secondaryYellow"
                              size="sm"
                              disabled={!team.canAccept || Boolean(busyAction)}
                              title={team.canAccept ? `Accept the challenge from ${team.side === 'home' ? fixture.away.name : fixture.home.name}` : team.acceptDisabledReason}
                              onClick={() => void runAction(fixture, team, 'accept')}
                            >
                              Accept from {team.side === 'home' ? fixture.away.name : fixture.home.name}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
        {!loading && !error && selectedTournamentId && data && !data.currentRound && (
          <p className={styles.empty}>This tournament has no current materialized round with fixtures.</p>
        )}
      </SectionCard>
    </section>
  );
}
