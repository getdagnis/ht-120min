import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise } from 'phosphor-react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { HATTRICK_WORLD_DETAILS } from '../../../shared/worlddetails';
import styles from './ForgeMatches.module.sass';

interface TournamentTeamOption {
  id: string;
  name: string;
  managerName: string | null;
  managerCountryName: string | null;
  managerLastSeenAt: string | null;
  autoArrangeEnabled: boolean;
}

interface TournamentOption {
  id: string;
  name: string;
  slug: string | null;
  season: number;
  status: string | null;
  currentRoundNumber: number | null;
  roundDate: string | null;
  matchCount: number;
  bookedCount: number;
  misarrangedCount: number;
  pendingAutoArrangeOffCount: number;
  readyToBookCount: number;
  teams: TournamentTeamOption[];
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

const SELECTION_STORAGE_KEY = 'forge.matches.selection';

function countryFlagFromName(countryName: string | null) {
  if (!countryName) return null;
  const normalized = countryName.trim().toLocaleLowerCase();
  return Object.values(HATTRICK_WORLD_DETAILS).find((country) =>
    country.countryName?.toLocaleLowerCase() === normalized
    || country.countryNameEn?.toLocaleLowerCase() === normalized,
  )?.emoji || null;
}

function formatPresence(value: string | null) {
  if (!value) return 'Last presence unavailable';
  return `Last presence ${new Date(value).toLocaleString('lv-LV', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function formatRoundDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('lv-LV', { day: '2-digit', month: '2-digit' });
}

function stateIsDangerous(state: string) {
  return ['MISARRANGED', 'CHPP CREDENTIALS MISSING', 'CHPP PERMISSION MISSING', 'CHPP OWNERSHIP MISMATCH', 'CHPP ERROR'].includes(state);
}

export function ForgeMatchesSection() {
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [selectedRoundNumber, setSelectedRoundNumber] = useState<number | null>(null);
  const [selectionRestored, setSelectionRestored] = useState(false);
  const [tournamentOptionsLoaded, setTournamentOptionsLoaded] = useState(false);
  const [refreshingData, setRefreshingData] = useState(false);
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
      setTournamentOptionsLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Forge tournaments.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async (
    tournamentId: string,
    roundNumber: number | null = null,
    showLoading = true,
  ) => {
    if (!tournamentId) {
      setData(null);
      return;
    }
    if (showLoading) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ tournamentId });
      if (roundNumber) params.set('roundNumber', String(roundNumber));
      const response = await fetch(`/api/forge/matches?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const payload = (await response.json()) as MatchesResponse;
      if (!response.ok) throw new Error(payload.error || 'Could not load tournament matches.');
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load tournament matches.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let restoreTimeoutId: number | undefined;
    try {
      const savedSelection = sessionStorage.getItem(SELECTION_STORAGE_KEY);
      if (savedSelection) {
        const parsed = JSON.parse(savedSelection) as { tournamentId?: unknown; roundNumber?: unknown };
        restoreTimeoutId = window.setTimeout(() => {
          if (typeof parsed.tournamentId === 'string') setSelectedTournamentId(parsed.tournamentId as string);
          if (typeof parsed.roundNumber === 'number' && Number.isSafeInteger(parsed.roundNumber) && parsed.roundNumber > 0) {
            setSelectedRoundNumber(parsed.roundNumber);
          }
          setSelectionRestored(true);
        }, 0);
      } else {
        restoreTimeoutId = window.setTimeout(() => setSelectionRestored(true), 0);
      }
    } catch {
      try {
        sessionStorage.removeItem(SELECTION_STORAGE_KEY);
      } catch {
        // Session storage can be unavailable in restricted browser contexts.
      }
      restoreTimeoutId = window.setTimeout(() => setSelectionRestored(true), 0);
    }
    return () => {
      if (restoreTimeoutId !== undefined) window.clearTimeout(restoreTimeoutId);
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadTournamentOptions();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadTournamentOptions]);

  useEffect(() => {
    if (!selectionRestored || !tournamentOptionsLoaded) return;
    if (selectedTournamentId && !tournaments.some((tournament) => tournament.id === selectedTournamentId)) {
      const timeoutId = window.setTimeout(() => {
        setSelectedTournamentId('');
        setSelectedRoundNumber(null);
        setData(null);
        setError('');
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
    const timeoutId = window.setTimeout(() => {
      void loadMatches(selectedTournamentId, selectedRoundNumber);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadMatches, selectedRoundNumber, selectedTournamentId, selectionRestored, tournamentOptionsLoaded, tournaments]);

  useEffect(() => {
    if (!selectionRestored) return;
    const roundNumber = selectedRoundNumber ?? data?.currentRound?.roundNumber ?? null;
    try {
      sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify({ tournamentId: selectedTournamentId, roundNumber }));
    } catch {
      // Keep the page usable when session storage is unavailable.
    }
  }, [data?.currentRound?.roundNumber, selectedRoundNumber, selectedTournamentId, selectionRestored]);

  const refreshData = async () => {
    if (!selectedTournamentId) return;
    setRefreshingData(true);
    setError('');
    setMessage('');
    try {
      await loadMatches(
        selectedTournamentId,
        selectedRoundNumber ?? data?.currentRound?.roundNumber ?? null,
        false,
      );
    } finally {
      setRefreshingData(false);
    }
  };

  const chooseTournament = (tournamentId: string) => {
    setSelectedTournamentId(tournamentId);
    setSelectedRoundNumber(null);
    setData(null);
    setMessage('');
    setError('');
  };

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
      <div className={styles.bookingLayout}>
      <div className={styles.bookingMain}>
      <SectionCard title="Match booking" subtitle="Coordinate any materialized tournament round directly from its fixtures." className={styles.surfaceCard}>
        <div className={styles.toolbar}>
          <label className={styles.label} htmlFor="forge-matches-tournament">Tournament</label>
          <select
            id="forge-matches-tournament"
            className={styles.select}
            value={selectedTournamentId}
            onChange={(event) => chooseTournament(event.target.value)}
          >
            <option value="">Choose a tournament</option>
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name} · {tournament.status || 'listed'}
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
        {!loading && !error && !selectedTournamentId && (
          <div className={styles.overviewList}>
            {tournaments.length === 0 ? <p className={styles.empty}>No currently listed tournaments.</p> : tournaments.map((tournament) => (
              <article key={tournament.id} className={styles.overviewTournament}>
                <div className={styles.overviewHeading}>
                  <div className={styles.overviewTitleRow}>
                    {tournament.slug
                      ? <a className={styles.overviewTournamentLink} href={`/en/t/${encodeURIComponent(tournament.slug)}`} target="_blank" rel="noopener noreferrer">{tournament.name}</a>
                      : <h2 className={styles.overviewTournamentTitle}>{tournament.name}</h2>}
                    <span className={styles.tournamentStatus}>{tournament.status || 'unknown'}</span>
                  </div>
                  <div className={styles.overviewMeta}>
                    <span>Season {tournament.season}</span>
                    {tournament.currentRoundNumber && <span>Round {tournament.currentRoundNumber}</span>}
                    <span>{tournament.teams.length} teams</span>
                    {tournament.roundDate && <span>Next round {formatRoundDate(tournament.roundDate)}</span>}
                  </div>
                </div>
                {tournament.teams.length > 0 ? (
                  <div className={styles.overviewTeams}>
                    {tournament.teams.map((team) => {
                      const flag = countryFlagFromName(team.managerCountryName);
                      return (
                        <div key={team.id} className={styles.overviewTeam}>
                          <div className={styles.overviewTeamName}>{team.name}</div>
                          <div className={styles.overviewManager}>
                            {flag && <span title={team.managerCountryName || undefined}>{flag}</span>}
                            <span>{team.managerName || 'Manager unavailable'}</span>
                          </div>
                          <div className={styles.overviewPresence}>{formatPresence(team.managerLastSeenAt)}</div>
                          {!team.autoArrangeEnabled && <span className={styles.autoArrangeOff}>Auto-arrange matches off</span>}
                        </div>
                      );
                    })}
                  </div>
                ) : <p className={styles.empty}>No active teams listed.</p>}
              </article>
            ))}
          </div>
        )}
        {!loading && !error && selectedTournamentId && data?.currentRound && (
          <div>
            <div className={styles.roundHeading}>
              <h2 className={styles.roundTitle}>{data.tournament?.name}</h2>
              <div className={styles.roundActions}>
                <span className={styles.roundMeta}>Round {data.currentRound.roundNumber}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || refreshingData || Boolean(busyAction)}
                  onClick={() => void refreshData()}
                >
                  <ArrowClockwise size={16} />
                  {refreshingData ? 'Refreshing...' : 'Refresh data'}
                </Button>
              </div>
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
      </div>

      <aside className={styles.bookingSidebar}>
        <SectionCard title="Bookable matches" subtitle="Current materialized rounds." className={styles.surfaceCard}>
          {tournaments.length === 0
            ? <p className={styles.empty}>No tournaments have a current materialized round.</p>
            : tournaments.map((tournament) => (
              <button
                key={tournament.id}
                type="button"
                className={`${styles.bookingTournamentLink} ${selectedTournamentId === tournament.id ? styles.bookingTournamentLinkActive : ''}`}
                onClick={() => chooseTournament(tournament.id)}
                aria-label={`Show matches for ${tournament.name}`}
              >
                <strong>{tournament.name}</strong>
                <span className={styles.bookingTournamentMeta}>
                  {tournament.currentRoundNumber ? `Round ${tournament.currentRoundNumber}` : 'No materialized round'}
                  {tournament.roundDate && ` · Next round: ${formatRoundDate(tournament.roundDate)}.`}
                </span>
                {tournament.matchCount > 0 && (
                  <span className={styles.bookingTournamentSummary}>
                    {tournament.bookedCount}/{tournament.matchCount} booked
                    {tournament.misarrangedCount > 0 && ` · ${tournament.misarrangedCount} misarranged`}
                    {tournament.pendingAutoArrangeOffCount > 0 && ` · ${tournament.pendingAutoArrangeOffCount} pending (auto-off)`}
                    {tournament.readyToBookCount > 0 && ` · ${tournament.readyToBookCount} open`}
                  </span>
                )}
              </button>
            ))}
        </SectionCard>
      </aside>
      </div>
    </section>
  );
}
