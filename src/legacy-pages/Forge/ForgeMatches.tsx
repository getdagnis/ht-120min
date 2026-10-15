import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise } from 'phosphor-react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { Tooltip } from '../../components/Tooltip/Tooltip';
import { formatPresence as formatRelativePresence, getCountryFlagUrl } from '../../utils/ht-data';
import { HATTRICK_WORLD_DETAILS } from '../../../shared/worlddetails';
import styles from './ForgeMatches.module.sass';

interface TournamentTeamOption {
  id: string;
  name: string;
  htTeamId: number | null;
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
  countryId: number | null;
  countryName: string | null;
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
  fixtureErrors?: Array<{ matchId: string; error: string }>;
  action?: { type: 'challenge' | 'accept'; matchId: string; actingSide: 'home' | 'away'; message: string } | null;
  error?: string;
}

const SELECTION_STORAGE_KEY = 'forge.matches.selection';
const FIXTURE_STATUS_FILTERS = [
  { status: 'misarranged', label: 'Misarranged' },
  { status: 'not_arranged', label: 'Not arranged' },
  { status: 'arranged', label: 'Arranged' },
] as const;
type FixtureStatusFilter = (typeof FIXTURE_STATUS_FILTERS)[number]['status'];

function fixtureStatusFilter(status: string): FixtureStatusFilter {
  if (status === 'misarranged') return 'misarranged';
  if (status === 'arranged' || status === 'ongoing' || status === 'finished') return 'arranged';
  return 'not_arranged';
}

function countryFlagFromName(countryName: string | null) {
  if (!countryName) return null;
  const normalized = countryName.trim().toLocaleLowerCase();
  return (
    Object.values(HATTRICK_WORLD_DETAILS).find(
      (country) =>
        country.countryName?.toLocaleLowerCase() === normalized ||
        country.countryNameEn?.toLocaleLowerCase() === normalized,
    )?.emoji || null
  );
}

function formatPrecisePresence(value: string | null) {
  if (!value) return 'No recent activity recorded';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'No recent activity recorded';
  return `Seen ${date.toLocaleString('lv-LV', {
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
  return [
    'MISARRANGED',
    'CHPP CREDENTIALS MISSING',
    'CHPP PERMISSION MISSING',
    'CHPP OWNERSHIP MISMATCH',
    'CHPP ERROR',
  ].includes(state);
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
  const [busyActions, setBusyActions] = useState<Record<string, boolean>>({});
  const [fixtureErrors, setFixtureErrors] = useState<Record<string, string>>({});
  const [fixtureMessages, setFixtureMessages] = useState<Record<string, string>>({});
  const [visibleStatuses, setVisibleStatuses] = useState<Record<FixtureStatusFilter, boolean>>({
    misarranged: true, not_arranged: true, arranged: true,
  });
  const loadEpoch = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const fixtureVersions = useRef(new Map<string, number>());
  const lockedFixtures = useRef(new Set<string>());

  const loadTournamentOptions = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    if (showLoading) setError('');
    try {
      const response = await fetch('/api/forge/matches', { credentials: 'include', cache: 'no-store' });
      const payload = (await response.json()) as MatchesResponse;
      if (!response.ok) throw new Error(payload.error || 'Could not load Forge tournaments.');
      setTournaments(payload.tournaments || []);
      setTournamentOptionsLoaded(true);
    } catch (loadError) {
      const reason = loadError instanceof Error ? loadError.message : 'Could not load Forge tournaments.';
      if (showLoading) setError(reason);
      else setMessage(reason);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const checkFixtures = useCallback(async (
    tournamentId: string, roundNumber: number, ids: string[], epoch: number, signal?: AbortSignal,
  ) => {
    const requested = ids.filter(id => !lockedFixtures.current.has(id));
    if (!requested.length) return;
    const versions = new Map(requested.map(id => {
      const version = (fixtureVersions.current.get(id) || 0) + 1;
      fixtureVersions.current.set(id, version);
      return [id, version];
    }));
    const isCurrent = (id: string) => loadEpoch.current === epoch
      && fixtureVersions.current.get(id) === versions.get(id) && !lockedFixtures.current.has(id);
    try {
      const params = new URLSearchParams({ tournamentId, roundNumber: String(roundNumber), view: 'states', matchIds: requested.join(',') });
      const response = await fetch(`/api/forge/matches?${params.toString()}`, {
        credentials: 'include', cache: 'no-store', signal,
      });
      const payload = (await response.json()) as MatchesResponse;
      if (!response.ok) throw new Error(payload.error || 'Could not check fixture states.');
      const updates = (payload.fixtures || []).filter(fixture => isCurrent(fixture.id));
      if (updates.length) {
        const byId = new Map(updates.map(fixture => [fixture.id, fixture]));
        setData(current => current && loadEpoch.current === epoch ? {
          ...current, fixtures: current.fixtures?.map(fixture => byId.get(fixture.id) || fixture),
        } : current);
      }
      const errors = new Map((payload.fixtureErrors || []).map(item => [item.matchId, item.error]));
      setFixtureErrors(current => {
        const next = { ...current };
        for (const id of requested) if (isCurrent(id)) {
          if (errors.has(id)) next[id] = errors.get(id)!;
          else delete next[id];
        }
        return next;
      });
    } catch (checkError) {
      if (signal?.aborted) return;
      const reason = checkError instanceof Error ? checkError.message : 'Could not check fixture states.';
      setFixtureErrors(current => {
        const next = { ...current };
        for (const id of requested) if (isCurrent(id)) next[id] = reason;
        return next;
      });
    }
  }, []);

  const checkAllFixtures = useCallback(async (
    tournamentId: string, roundNumber: number, ids: string[], epoch: number, signal: AbortSignal,
  ) => {
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += 4) batches.push(ids.slice(index, index + 4));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(2, batches.length) }, async () => {
      while (cursor < batches.length && !signal.aborted && loadEpoch.current === epoch) {
        const batch = batches[cursor++];
        await checkFixtures(tournamentId, roundNumber, batch, epoch, signal);
      }
    }));
  }, [checkFixtures]);

  const loadMatches = useCallback(
    async (tournamentId: string, roundNumber: number | null = null, showLoading = true) => {
      const epoch = ++loadEpoch.current;
      loadController.current?.abort();
      const controller = new AbortController();
      loadController.current = controller;
      if (!tournamentId) {
        setData(null);
        return;
      }
      if (showLoading) setLoading(true);
      if (showLoading) setError('');
      try {
        const params = new URLSearchParams({ tournamentId, view: 'base' });
        if (roundNumber) params.set('roundNumber', String(roundNumber));
        const response = await fetch(`/api/forge/matches?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = (await response.json()) as MatchesResponse;
        if (!response.ok) throw new Error(payload.error || 'Could not load tournament matches.');
        if (loadEpoch.current !== epoch) return;
        setData(payload);
        setFixtureErrors({});
        setFixtureMessages({});
        if (payload.currentRound && payload.fixtures?.length) {
          void checkAllFixtures(tournamentId, payload.currentRound.roundNumber,
            payload.fixtures.map(fixture => fixture.id), epoch, controller.signal);
        }
      } catch (loadError) {
        if (!controller.signal.aborted && loadEpoch.current === epoch) {
          const reason = loadError instanceof Error ? loadError.message : 'Could not load tournament matches.';
          if (showLoading) setError(reason);
          else setMessage(reason);
        }
      } finally {
        if (showLoading && loadEpoch.current === epoch) setLoading(false);
      }
    },
    [checkAllFixtures],
  );

  const chooseTournament = (tournamentId: string) => {
    loadEpoch.current++;
    loadController.current?.abort();
    setSelectedTournamentId(tournamentId);
    setSelectedRoundNumber(null);
    setData(null);
    setMessage('');
    setError('');
    setBusyActions({});
  };

  useEffect(() => {
    let restoreTimeoutId: number | undefined;
    try {
      const savedSelection = sessionStorage.getItem(SELECTION_STORAGE_KEY);
      if (savedSelection) {
        const parsed = JSON.parse(savedSelection) as { tournamentId?: unknown; roundNumber?: unknown };
        restoreTimeoutId = window.setTimeout(() => {
          if (typeof parsed.tournamentId === 'string') setSelectedTournamentId(parsed.tournamentId as string);
          if (
            typeof parsed.roundNumber === 'number' &&
            Number.isSafeInteger(parsed.roundNumber) &&
            parsed.roundNumber > 0
          ) {
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
    const timeoutId = window.setTimeout(() => {
      void loadMatches(selectedTournamentId, selectedRoundNumber);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadMatches, selectedRoundNumber, selectedTournamentId, selectionRestored, tournamentOptionsLoaded]);

  useEffect(() => {
    if (tournamentOptionsLoaded && selectedTournamentId
      && !tournaments.some(tournament => tournament.id === selectedTournamentId)) {
      const timeoutId = window.setTimeout(() => chooseTournament(''), 0);
      return () => window.clearTimeout(timeoutId);
    }
  // Tournament option refreshes must not restart the round's CHPP checks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentOptionsLoaded, tournaments]);

  useEffect(() => () => {
    loadEpoch.current++;
    loadController.current?.abort();
  }, []);

  useEffect(() => {
    if (!selectionRestored) return;
    const roundNumber = selectedRoundNumber ?? data?.currentRound?.roundNumber ?? null;
    try {
      sessionStorage.setItem(
        SELECTION_STORAGE_KEY,
        JSON.stringify({ tournamentId: selectedTournamentId, roundNumber }),
      );
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
      await Promise.all([
        loadMatches(selectedTournamentId, selectedRoundNumber ?? data?.currentRound?.roundNumber ?? null, false),
        loadTournamentOptions(false),
      ]);
    } finally {
      setRefreshingData(false);
    }
  };


  const runAction = async (fixture: ForgeFixtureView, team: ForgeTeamView, action: 'challenge' | 'accept') => {
    const opponent = team.side === 'home' ? fixture.away : fixture.home;
    const verb = action === 'challenge' ? 'Send' : 'Accept';
    const prompt =
      action === 'challenge'
        ? `Send a Cup Rules challenge from ${team.name} to ${opponent.name}?`
        : `Accept the pending challenge from ${opponent.name} for ${team.name}?`;
    if (!window.confirm(`${prompt}\n\nThis performs a real Hattrick action.`)) return;

    const tournamentId = selectedTournamentId;
    const roundNumber = data?.currentRound?.roundNumber;
    const epoch = loadEpoch.current;
    if (!roundNumber || lockedFixtures.current.has(fixture.id)) return;
    lockedFixtures.current.add(fixture.id);
    fixtureVersions.current.set(fixture.id, (fixtureVersions.current.get(fixture.id) || 0) + 1);
    setBusyActions(current => ({ ...current, [fixture.id]: true }));
    setFixtureErrors(current => { const next = { ...current }; delete next[fixture.id]; return next; });
    setFixtureMessages(current => { const next = { ...current }; delete next[fixture.id]; return next; });
    let actionFailure: string | null = null;
    try {
      const response = await fetch('/api/forge/matches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId,
          matchId: fixture.id,
          roundNumber,
          actingSide: team.side,
          action,
          compactResponse: true,
        }),
      });
      const payload = (await response.json()) as MatchesResponse;
      if (!response.ok) throw new Error(payload.error || `${verb} action failed.`);

      let refreshNote = '';
      if (action === 'accept') {
        try {
          const refreshResponse = await fetch(
            `/api/teams/refresh-fixtures?tournament_id=${encodeURIComponent(tournamentId)}`,
            { credentials: 'include' },
          );
          if (!refreshResponse.ok) refreshNote = ' Local fixture refresh did not complete; use Refresh Fixtures to reconcile it.';
        } catch {
          refreshNote = ' Local fixture refresh did not complete; reload or use Refresh Fixtures to reconcile it.';
        }
      }
      if (loadEpoch.current !== epoch) return;
      setFixtureMessages(current => ({ ...current, [fixture.id]: `${payload.action?.message || `${verb} action completed.`}${refreshNote}` }));
    } catch (actionError) {
      actionFailure = actionError instanceof Error ? actionError.message : `${verb} action failed.`;
    } finally {
      lockedFixtures.current.delete(fixture.id);
      if (loadEpoch.current === epoch) {
        await checkFixtures(tournamentId, roundNumber, [fixture.id], epoch);
        if (actionFailure) setFixtureErrors(current => ({ ...current, [fixture.id]: actionFailure! }));
        setBusyActions(current => { const next = { ...current }; delete next[fixture.id]; return next; });
      }
    }
  };

  const visibleFixtureCount = data?.fixtures?.filter(fixture => visibleStatuses[fixtureStatusFilter(fixture.status)]).length ?? 0;

  return (
    <section className={styles.page}>
      <div className={styles.bookingLayout}>
        <div className={styles.bookingMain}>
          <SectionCard
            title="Match booking"
            subtitle="Coordinate any materialized tournament round directly from its fixtures."
            className={styles.surfaceCard}
          >
            <div className={styles.toolbar}>
              <label className={styles.label} htmlFor="forge-matches-tournament">
                Tournament
              </label>
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
                <label className={styles.label} htmlFor="forge-matches-round">
                  Round
                </label>
                <select
                  id="forge-matches-round"
                  className={styles.select}
                  value={selectedRoundNumber || data.currentRound?.roundNumber || ''}
                  onChange={(event) => {
                    const nextRoundNumber = Number(event.target.value);
                    setSelectedRoundNumber(Number.isSafeInteger(nextRoundNumber) ? nextRoundNumber : null);
                    loadEpoch.current++;
                    loadController.current?.abort();
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
                {tournaments.length === 0 ? (
                  <p className={styles.empty}>No currently listed tournaments.</p>
                ) : (
                  tournaments.map((tournament) => (
                    <article key={tournament.id} className={styles.overviewTournament}>
                      <div className={styles.overviewHeading}>
                        <div className={styles.overviewTitleRow}>
                          {tournament.slug ? (
                            <a
                              className={styles.overviewTournamentLink}
                              href={`/en/t/${encodeURIComponent(tournament.slug)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {tournament.name}
                            </a>
                          ) : (
                            <h2 className={styles.overviewTournamentTitle}>{tournament.name}</h2>
                          )}
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
                            const presence = formatRelativePresence(team.managerLastSeenAt);
                            const presenceTooltipId = `forge-team-presence-${team.id}`;
                            return (
                              <div key={team.id} className={styles.overviewTeam}>
                                <div className={styles.overviewTeamName}>{team.name}</div>
                                <div className={styles.overviewManager}>
                                  {flag && <span title={team.managerCountryName || undefined}>{flag}</span>}
                                  <span>{team.managerName || 'Manager unavailable'}</span>
                                </div>
                                <div className={styles.overviewTeamMeta}>
                                  {team.htTeamId !== null && (
                                    <a
                                      className={styles.overviewTeamId}
                                      href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.htTeamId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      ID: {team.htTeamId}
                                    </a>
                                  )}
                                  {team.htTeamId !== null && <span aria-hidden="true">|</span>}
                                  <span>Last seen:</span>
                                  <span
                                    className={`${styles.overviewPresence} ${styles[`presence_${presence.color}`]}`}
                                    data-tooltip-id={presenceTooltipId}
                                    aria-label={formatPrecisePresence(team.managerLastSeenAt)}
                                  >
                                    {presence.online ? '✔︎' : presence.label}
                                  </span>
                                  <Tooltip
                                    id={presenceTooltipId}
                                    content={formatPrecisePresence(team.managerLastSeenAt)}
                                    className="tooltip"
                                  />
                                </div>
                                {!team.autoArrangeEnabled && (
                                  <span className={styles.autoArrangeOff}>Auto-arrange matches off</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className={styles.empty}>No active teams listed.</p>
                      )}
                    </article>
                  ))
                )}
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
                      disabled={loading || refreshingData || Object.keys(busyActions).length > 0}
                      onClick={() => void refreshData()}
                    >
                      <ArrowClockwise size={16} />
                      {refreshingData ? 'Refreshing...' : 'Refresh data'}
                    </Button>
                  </div>
                </div>
                {message && <p className={styles.success}>{message}</p>}
                <fieldset className={styles.fixtureFilters}>
                  <legend>Show matches</legend>
                  {FIXTURE_STATUS_FILTERS.map(({ status, label }) => (
                    <label key={status} className={styles.fixtureFilter}>
                      <input
                        type="checkbox"
                        checked={visibleStatuses[status]}
                        onChange={event => setVisibleStatuses(current => ({ ...current, [status]: event.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                {visibleFixtureCount === 0 && <p className={styles.empty}>No matches match the selected statuses.</p>}
                <div className={styles.fixtureList}>
                  {(data.fixtures || []).map((fixture, index) => {
                    if (!visibleStatuses[fixtureStatusFilter(fixture.status)]) return null;
                    const fixtureBusy = Boolean(busyActions[fixture.id]);
                    return (
                      <article key={fixture.id} className={styles.fixture}>
                        <div className={styles.fixtureHeader}>
                          <span className={styles.fixtureNumber}>Match {index + 1}</span>
                          {fixtureErrors[fixture.id] && (
                            <span role="alert" className={styles.error}>
                              {fixtureErrors[fixture.id]}{' '}
                              {!fixtureBusy && <button type="button" onClick={() => {
                                if (data.currentRound) void checkFixtures(selectedTournamentId, data.currentRound.roundNumber,
                                  [fixture.id], loadEpoch.current);
                              }}>Retry check</button>}
                            </span>
                          )}
                          {fixtureMessages[fixture.id] && <span role="status" className={styles.success}>{fixtureMessages[fixture.id]}</span>}
                        </div>
                        <div className={styles.fixtureTeams}>
                          {[fixture.home, fixture.away].map((team) => (
                            <div key={team.side} className={styles.teamRow}>
                              <div className={styles.teamIdentity}>
                                <div className={styles.teamName}>
                                  {getCountryFlagUrl(team.countryId, team.countryName) && (
                                    <img
                                      src={getCountryFlagUrl(team.countryId, team.countryName)!}
                                      alt=""
                                      title={team.countryName || undefined}
                                      className={styles.teamFlag}
                                    />
                                  )}
                                  <span>{team.name}</span>
                                </div>
                                <div className={styles.managerName}>{team.managerName || 'Manager unavailable'}</div>
                              </div>
                              <div className={styles.stateRow}>
                                <span
                                  className={`${styles.stateBadge} ${team.chppState === 'ARRANGED' ? styles.stateBadgeArranged : ''} ${stateIsDangerous(team.chppState) ? styles.stateBadgeDanger : ''}`}
                                >
                                  {team.chppState}
                                </span>
                                {team.autoArrangeEnabled !== null && (
                                  <span
                                    className={`${styles.stateBadge} ${team.autoArrangeEnabled ? styles.autoArrangeEnabled : styles.autoArrangeDisabled}`}
                                  >
                                    AUTO-ARRANGE {team.autoArrangeEnabled ? 'ON' : 'OFF'}
                                  </span>
                                )}
                              </div>
                              <p className={styles.stateReason}>{team.chppReason}</p>
                              <div className={styles.actions}>
                                <Button
                                  variant="primaryAction"
                                  size="sm"
                                  disabled={!team.canChallenge || fixtureBusy}
                                  title={
                                    team.canChallenge
                                      ? `Send a Cup Rules challenge to ${team.side === 'home' ? fixture.away.name : fixture.home.name}`
                                      : team.challengeDisabledReason
                                  }
                                  onClick={() => void runAction(fixture, team, 'challenge')}
                                >
                                  Challenge {team.side === 'home' ? fixture.away.name : fixture.home.name}
                                </Button>
                                <Button
                                  variant="secondaryDanger"
                                  size="sm"
                                  disabled={!team.canAccept || fixtureBusy}
                                  title={
                                    team.canAccept
                                      ? `Accept the challenge from ${team.side === 'home' ? fixture.away.name : fixture.home.name}`
                                      : team.acceptDisabledReason
                                  }
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
            {tournaments.length === 0 ? (
              <p className={styles.empty}>No tournaments have a current materialized round.</p>
            ) : (
              tournaments.map((tournament) => {
                const hasMisarranged = tournament.misarrangedCount > 0;
                const fullyBooked =
                  tournament.matchCount > 0 &&
                  tournament.bookedCount > 0 &&
                  tournament.bookedCount + tournament.misarrangedCount === tournament.matchCount &&
                  tournament.readyToBookCount === 0 &&
                  tournament.pendingAutoArrangeOffCount === 0;
                const statusIcon =
                  tournament.matchCount === 0
                    ? ''
                    : hasMisarranged
                      ? fullyBooked
                        ? '✅⚠️'
                        : '⚠️'
                      : fullyBooked
                        ? '✅'
                        : '📬';
                return (
                  <button
                    key={tournament.id}
                    type="button"
                    className={`${styles.bookingTournamentLink} ${fullyBooked ? styles.bookingTournamentLinkBooked : ''} ${selectedTournamentId === tournament.id ? styles.bookingTournamentLinkActive : ''}`}
                    onClick={() => chooseTournament(tournament.id)}
                    aria-label={`Show matches for ${tournament.name}`}
                  >
                    <strong>
                      {statusIcon && <span aria-hidden="true">{statusIcon} </span>}
                      {tournament.name}
                    </strong>
                    <span className={styles.bookingTournamentMeta}>
                      {tournament.currentRoundNumber
                        ? `Round ${tournament.currentRoundNumber}`
                        : 'No materialized round'}
                      {tournament.roundDate && ` · Next round: ${formatRoundDate(tournament.roundDate)}`}
                    </span>
                    {tournament.matchCount > 0 && (
                      <span className={styles.bookingTournamentSummary}>
                        {tournament.bookedCount}/{tournament.matchCount} booked
                        {tournament.misarrangedCount > 0 && ` · ${tournament.misarrangedCount} misarranged`}
                        {tournament.pendingAutoArrangeOffCount > 0 &&
                          ` · ${tournament.pendingAutoArrangeOffCount} pending (auto-off)`}
                        {tournament.readyToBookCount > 0 && ` · ${tournament.readyToBookCount} open`}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </SectionCard>
        </aside>
      </div>
    </section>
  );
}
