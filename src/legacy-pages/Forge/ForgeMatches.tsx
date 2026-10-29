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
  currentRoundLabel?: string | null;
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
  roundLabel?: string;
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
  canWithdraw: boolean;
  autoArrangeEnabled: boolean | null;
  savedFlags?: { home: number[]; away: number[]; fetchedAt: string } | null;
  latest120mRating?: {
    score: number;
    grade: string;
    matchId: string;
    htMatchId: number | null;
    matchDate: string | null;
  } | null;
  challengeDisabledReason: string;
  acceptDisabledReason?: string;
}

interface ForgeFixtureView {
  id: string;
  status: string;
  completed: boolean;
  htMatchId: number | null;
  scheduledFor?: string | null;
  home: ForgeTeamView;
  away: ForgeTeamView;
}

function isByeTeam(team: ForgeTeamView) {
  return team.name === 'BYE' && team.htTeamId === null;
}

interface MatchesResponse {
  tournaments?: TournamentOption[];
  tournament?: { id: string; name: string; slug: string | null; season: number };
  currentRound?: { id: string; roundNumber: number; roundLabel?: string; phase: string; phaseStatus: string } | null;
  roundOptions?: RoundOption[];
  fixtures?: ForgeFixtureView[];
  fixtureErrors?: Array<{ matchId: string; error: string }>;
  action?: {
    type: 'challenge' | 'accept' | 'withdraw' | 'reverse';
    matchId: string;
    actingSide: 'home' | 'away';
    message: string;
  } | null;
  error?: string;
}

type BulkResult = { status: 'booked' | 'pending' | 'skipped' | 'failed'; reason: string };

function isChallengeRefusal(message: string) {
  return /(?:does not|doesn't|won't|has chosen not to) accept (?:friendly )?challenges|(?:is )?not accepting (?:friendly )?challenges/i.test(
    message,
  );
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

function mergeFixtureState(fixture: ForgeFixtureView, state: ForgeFixtureView | undefined) {
  return state
    ? {
        ...fixture,
        ...state,
        home: {
          ...fixture.home,
          ...state.home,
          savedFlags: fixture.home.savedFlags,
          latest120mRating: fixture.home.latest120mRating,
        },
        away: {
          ...fixture.away,
          ...state.away,
          savedFlags: fixture.away.savedFlags,
          latest120mRating: fixture.away.latest120mRating,
        },
      }
    : fixture;
}

function csvCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Names and challenge text originate outside Forge and may be opened in a spreadsheet.
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function exportRoundCsv(data: MatchesResponse, fixtureErrors: Record<string, string>) {
  const columns = [
    'tournament_id',
    'tournament_name',
    'season',
    'round_id',
    'round_number',
    'fixture_id',
    'fixture_status',
    'completed',
    'fixture_ht_match_id',
    'scheduled_for',
    'challenge_load_error',
    ...(['home', 'away'] as const).flatMap((side) => [
      `${side}_team_id`,
      `${side}_ht_team_id`,
      `${side}_team_name`,
      `${side}_country_id`,
      `${side}_country_name`,
      `${side}_manager_ht_id`,
      `${side}_manager_name`,
      `${side}_auto_arrange_enabled`,
      `${side}_challenge_state`,
      `${side}_challenge_reason`,
      `${side}_saved_home_flag_league_ids`,
      `${side}_saved_away_flag_league_ids`,
      `${side}_flags_fetched_at`,
      `${side}_latest_120mrt_score`,
      `${side}_latest_120mrt_grade`,
      `${side}_120mrt_source_fixture_id`,
      `${side}_120mrt_source_ht_match_id`,
      `${side}_120mrt_source_match_date`,
    ]),
  ];
  const rows = (data.fixtures || []).map((fixture) => {
    const sideValues = (team: ForgeTeamView) => {
      const bye = isByeTeam(team);
      const flags = team.savedFlags;
      const rating = team.latest120mRating;
      return [
        bye ? null : team.id,
        team.htTeamId,
        bye ? null : team.name,
        team.countryId,
        team.countryName,
        team.managerHtId,
        team.managerName,
        team.autoArrangeEnabled,
        team.chppState === 'CHECKING' ? null : team.chppState,
        team.chppState === 'CHECKING' ? null : team.chppReason,
        flags ? flags.home.join(';') : null,
        flags ? flags.away.join(';') : null,
        flags?.fetchedAt,
        rating?.score,
        rating?.grade,
        rating?.matchId,
        rating?.htMatchId,
        rating?.matchDate,
      ];
    };
    return [
      data.tournament?.id,
      data.tournament?.name,
      data.tournament?.season,
      data.currentRound?.id,
      data.currentRound?.roundNumber,
      fixture.id,
      fixture.status,
      fixture.completed,
      fixture.htMatchId,
      fixture.scheduledFor,
      fixtureErrors[fixture.id],
      ...sideValues(fixture.home),
      ...sideValues(fixture.away),
    ]
      .map(csvCell)
      .join(',');
  });
  const csv = `\uFEFF${[columns.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`;
  const filename = `forge-${data.tournament?.id || 'tournament'}-round-${data.currentRound?.roundNumber || 'unknown'}.csv`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ForgeMatchesSection() {
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [autoBooking, setAutoBooking] = useState<boolean | null>(null);
  const [autoBookingBusy, setAutoBookingBusy] = useState(false);
  const [autoBookingError, setAutoBookingError] = useState('');
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
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkResults, setBulkResults] = useState<Record<string, BulkResult>>({});
  const stopBulk = useRef(false);
  const [visibleStatuses, setVisibleStatuses] = useState<Record<FixtureStatusFilter, boolean>>({
    misarranged: true,
    not_arranged: true,
    arranged: true,
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

  const checkFixtures = useCallback(
    async (tournamentId: string, roundNumber: number, ids: string[], epoch: number, signal?: AbortSignal) => {
      const requested = ids.filter((id) => !lockedFixtures.current.has(id));
      if (!requested.length) return;
      const versions = new Map(
        requested.map((id) => {
          const version = (fixtureVersions.current.get(id) || 0) + 1;
          fixtureVersions.current.set(id, version);
          return [id, version];
        }),
      );
      const isCurrent = (id: string) =>
        loadEpoch.current === epoch &&
        fixtureVersions.current.get(id) === versions.get(id) &&
        !lockedFixtures.current.has(id);
      try {
        const params = new URLSearchParams({
          tournamentId,
          roundNumber: String(roundNumber),
          view: 'states',
          matchIds: requested.join(','),
        });
        const response = await fetch(`/api/forge/matches?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
          signal,
        });
        const payload = (await response.json()) as MatchesResponse;
        if (!response.ok) throw new Error(payload.error || 'Could not check fixture states.');
        const updates = (payload.fixtures || []).filter((fixture) => isCurrent(fixture.id));
        if (updates.length) {
          const byId = new Map(updates.map((fixture) => [fixture.id, fixture]));
          setData((current) =>
            current && loadEpoch.current === epoch
              ? {
                  ...current,
                  fixtures: current.fixtures?.map((fixture) => mergeFixtureState(fixture, byId.get(fixture.id))),
                }
              : current,
          );
        }
        const errors = new Map((payload.fixtureErrors || []).map((item) => [item.matchId, item.error]));
        setFixtureErrors((current) => {
          const next = { ...current };
          for (const id of requested)
            if (isCurrent(id)) {
              if (errors.has(id)) next[id] = errors.get(id)!;
              else delete next[id];
            }
          return next;
        });
      } catch (checkError) {
        if (signal?.aborted) return;
        const reason = checkError instanceof Error ? checkError.message : 'Could not check fixture states.';
        setFixtureErrors((current) => {
          const next = { ...current };
          for (const id of requested) if (isCurrent(id)) next[id] = reason;
          return next;
        });
      }
    },
    [],
  );

  const checkAllFixtures = useCallback(
    async (tournamentId: string, roundNumber: number, ids: string[], epoch: number, signal: AbortSignal) => {
      const batches: string[][] = [];
      for (let index = 0; index < ids.length; index += 4) batches.push(ids.slice(index, index + 4));
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(2, batches.length) }, async () => {
          while (cursor < batches.length && !signal.aborted && loadEpoch.current === epoch) {
            const batch = batches[cursor++];
            await checkFixtures(tournamentId, roundNumber, batch, epoch, signal);
          }
        }),
      );
    },
    [checkFixtures],
  );

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
          void checkAllFixtures(
            tournamentId,
            payload.currentRound.roundNumber,
            payload.fixtures.map((fixture) => fixture.id),
            epoch,
            controller.signal,
          );
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
    setAutoBooking(null);
    setAutoBookingError('');
    setSelectedTournamentId(tournamentId);
    setSelectedRoundNumber(null);
    setData(null);
    setMessage('');
    setError('');
    setBusyActions({});
  };

  useEffect(() => {
    if (!selectedTournamentId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ tournamentId: selectedTournamentId, setting: 'auto-booking' });
    void fetch(`/api/forge/matches?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { enabled?: boolean; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Could not load automatic booking setting.');
        setAutoBooking(payload.enabled === true);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setAutoBookingError(error instanceof Error ? error.message : 'Could not load automatic booking setting.');
      });
    return () => controller.abort();
  }, [selectedTournamentId]);

  const saveAutoBooking = async (enabled: boolean) => {
    setAutoBookingBusy(true);
    setAutoBookingError('');
    try {
      const response = await fetch('/api/forge/matches', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-auto-booking', tournamentId: selectedTournamentId, enabled }),
      });
      const payload = await response.json() as { enabled?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not save automatic booking setting.');
      setAutoBooking(payload.enabled === true);
    } catch (error) {
      setAutoBookingError(error instanceof Error ? error.message : 'Could not save automatic booking setting.');
    } finally {
      setAutoBookingBusy(false);
    }
  };

  useEffect(() => {
    let restoreTimeoutId: number | undefined;
    try {
      const query = new URLSearchParams(window.location.search);
      const requestedTournament = query.get('tournamentId');
      const requestedRound = Number(query.get('roundNumber'));
      const savedSelection =
        requestedTournament && Number.isSafeInteger(requestedRound) && requestedRound > 0
          ? JSON.stringify({ tournamentId: requestedTournament, roundNumber: requestedRound })
          : sessionStorage.getItem(SELECTION_STORAGE_KEY);
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
    if (
      tournamentOptionsLoaded &&
      selectedTournamentId &&
      !tournaments.some((tournament) => tournament.id === selectedTournamentId)
    ) {
      const timeoutId = window.setTimeout(() => chooseTournament(''), 0);
      return () => window.clearTimeout(timeoutId);
    }
    // Tournament option refreshes must not restart the round's CHPP checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentOptionsLoaded, tournaments]);

  useEffect(
    () => () => {
      stopBulk.current = true;
      loadEpoch.current++;
      loadController.current?.abort();
    },
    [],
  );

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

  const bookAll = async () => {
    const tournamentId = selectedTournamentId;
    const roundNumber = data?.currentRound?.roundNumber;
    if (!tournamentId || !roundNumber || bulkRunning || refreshingData || Object.keys(busyActions).length) return;
    if (
      !window.confirm(
        `Book eligible matches in ${data?.tournament?.name}, ${data?.currentRound?.roundLabel || `Round ${roundNumber}`}?\n\nThis will refresh Hattrick data, send Cup Rules challenges, then accept matching challenges. It performs real Hattrick actions.`,
      )
    )
      return;

    stopBulk.current = false;
    setBulkRunning(true);
    setBulkResults({});
    setBulkProgress('Refreshing fixture data...');
    loadController.current?.abort();
    const epoch = ++loadEpoch.current;
    const results: Record<string, BulkResult> = {};
    let allFixtureIds: string[] = [];
    let acceptedAny = false;
    const record = (id: string, status: BulkResult['status'], reason: string) => {
      results[id] = { status, reason };
      setBulkResults({ ...results });
    };
    const recordActionError = (id: string, error: unknown, fallback: string) => {
      const reason = error instanceof Error ? error.message : fallback;
      record(id, reason === 'Auto-arrange is off for a fixture team.' ? 'skipped' : 'failed', reason);
    };
    const request = async (url: string, init?: RequestInit) => {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...init });
      const payload = (await response.json()) as MatchesResponse;
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
      return payload;
    };
    const readRound = async (allowStop = true) => {
      const params = new URLSearchParams({ tournamentId, roundNumber: String(roundNumber), view: 'base' });
      const base = await request(`/api/forge/matches?${params}`);
      if (base.currentRound?.roundNumber !== roundNumber) throw new Error('The selected round is no longer available.');
      const fixtures = base.fixtures || [];
      allFixtureIds = fixtures.map((fixture) => fixture.id);
      const checked = new Map<string, ForgeFixtureView>();
      const checkErrors: Record<string, string> = {};
      for (let index = 0; index < fixtures.length; index += 4) {
        const batch = fixtures.slice(index, index + 4);
        const stateParams = new URLSearchParams({
          tournamentId,
          roundNumber: String(roundNumber),
          view: 'states',
          matchIds: batch.map((fixture) => fixture.id).join(','),
        });
        try {
          const states = await request(`/api/forge/matches?${stateParams}`);
          for (const fixture of states.fixtures || []) checked.set(fixture.id, fixture);
          for (const item of states.fixtureErrors || []) checkErrors[item.matchId] = item.error;
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Could not check Hattrick state.';
          for (const fixture of batch) checkErrors[fixture.id] = reason;
        }
        if (allowStop && stopBulk.current) break;
        setBulkProgress(`Checking Hattrick state ${Math.min(index + 4, fixtures.length)}/${fixtures.length}...`);
      }
      for (const fixture of fixtures)
        if ((!allowStop || !stopBulk.current) && !checked.has(fixture.id) && !checkErrors[fixture.id]) {
          checkErrors[fixture.id] = 'Hattrick state was not returned.';
        }
      if (loadEpoch.current === epoch) {
        setData({ ...base, fixtures: fixtures.map((fixture) => mergeFixtureState(fixture, checked.get(fixture.id))) });
        setFixtureErrors(checkErrors);
      }
      return { fixtures: fixtures.map((fixture) => mergeFixtureState(fixture, checked.get(fixture.id))), checkErrors };
    };
    const act = async (fixture: ForgeFixtureView, side: 'home' | 'away', action: 'challenge' | 'accept') => {
      return request('/api/forge/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId,
          roundNumber,
          matchId: fixture.id,
          actingSide: side,
          action,
          compactResponse: true,
          bulkAutoArrange: true,
        }),
      });
    };
    try {
      const first = await readRound();
      if (!stopBulk.current)
        for (const [index, fixture] of first.fixtures.entries()) {
          if (stopBulk.current) break;
          setBulkProgress(
            `Challenging ${index + 1}/${first.fixtures.length}: ${fixture.home.name} vs ${fixture.away.name}`,
          );
          if (first.checkErrors[fixture.id]) {
            record(fixture.id, 'failed', first.checkErrors[fixture.id]);
            continue;
          }
          if (fixture.completed || fixture.htMatchId || ['arranged', 'ongoing', 'finished'].includes(fixture.status)) {
            record(fixture.id, 'booked', 'Already booked.');
            continue;
          }
          if (fixture.status === 'misarranged') {
            record(fixture.id, 'skipped', 'Misarranged fixture.');
            continue;
          }
          if (fixture.home.autoArrangeEnabled !== true || fixture.away.autoArrangeEnabled !== true) {
            record(fixture.id, 'skipped', 'Auto-arrange is off or unavailable.');
            continue;
          }
          if (fixture.home.canAccept || fixture.away.canAccept) {
            record(fixture.id, 'pending', 'Existing challenge from the fixture opponent; checking acceptance next.');
            continue;
          }
          if (fixture.home.canWithdraw || fixture.away.canWithdraw) {
            record(
              fixture.id,
              'pending',
              'Existing outgoing challenge to the fixture opponent; checking acceptance next.',
            );
            continue;
          }
          const challenger = fixture.home.canChallenge ? fixture.home : fixture.away.canChallenge ? fixture.away : null;
          if (!challenger) {
            record(
              fixture.id,
              'failed',
              fixture.home.challengeDisabledReason ||
                fixture.away.challengeDisabledReason ||
                'Neither team can challenge.',
            );
            continue;
          }
          try {
            await act(fixture, challenger.side, 'challenge');
            record(fixture.id, 'pending', `Challenge sent from ${challenger.name}.`);
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'Challenge failed.';
            if (challenger.side === 'home' && isChallengeRefusal(reason) && fixture.away.canChallenge) {
              try {
                await act(fixture, 'away', 'challenge');
                record(
                  fixture.id,
                  'pending',
                  `Challenge sent from ${fixture.away.name} after ${fixture.home.name} was refused.`,
                );
              } catch (retryError) {
                recordActionError(fixture.id, retryError, 'Reverse-side challenge failed.');
              }
            } else recordActionError(fixture.id, error, 'Challenge failed.');
          }
        }

      if (!stopBulk.current) {
        setBulkProgress('Refreshing challenge states before acceptance...');
        const second = await readRound();
        for (const [index, fixture] of second.fixtures.entries()) {
          if (stopBulk.current) break;
          setBulkProgress(
            `Accepting ${index + 1}/${second.fixtures.length}: ${fixture.home.name} vs ${fixture.away.name}`,
          );
          if (results[fixture.id]?.status === 'skipped') continue;
          if (second.checkErrors[fixture.id]) {
            record(fixture.id, 'failed', second.checkErrors[fixture.id]);
            continue;
          }
          if (fixture.completed || fixture.htMatchId || ['arranged', 'ongoing', 'finished'].includes(fixture.status)) {
            record(fixture.id, 'booked', 'Already booked.');
            continue;
          }
          if (fixture.status === 'misarranged') {
            record(fixture.id, 'skipped', 'Misarranged fixture.');
            continue;
          }
          if (fixture.home.autoArrangeEnabled !== true || fixture.away.autoArrangeEnabled !== true) {
            record(fixture.id, 'skipped', 'Auto-arrange is off or unavailable.');
            continue;
          }
          const receiver = fixture.home.canAccept ? fixture.home : fixture.away.canAccept ? fixture.away : null;
          if (!receiver) {
            if (results[fixture.id]?.status !== 'failed')
              record(fixture.id, 'pending', 'No matching incoming challenge is ready to accept.');
            continue;
          }
          try {
            await act(fixture, receiver.side, 'accept');
            acceptedAny = true;
            record(fixture.id, 'pending', `Accepted by ${receiver.name}; awaiting fixture refresh.`);
          } catch (error) {
            recordActionError(fixture.id, error, 'Acceptance failed.');
          }
        }
      }

      if (acceptedAny) {
        setBulkProgress('Reconciling accepted fixtures...');
        await request(`/api/teams/refresh-fixtures?tournament_id=${encodeURIComponent(tournamentId)}`);
      }
      if (!stopBulk.current || acceptedAny) {
        setBulkProgress('Checking final booking states...');
        const final = await readRound(false);
        for (const fixture of final.fixtures) {
          if (final.checkErrors[fixture.id]) continue;
          if (fixture.completed || fixture.htMatchId || ['arranged', 'ongoing', 'finished'].includes(fixture.status)) {
            if (results[fixture.id]?.status !== 'skipped') record(fixture.id, 'booked', 'Booking confirmed.');
          }
        }
      }
      setBulkProgress(stopBulk.current ? 'Stopped after the current operation.' : 'Booking run complete.');
    } catch (error) {
      setBulkProgress(
        error instanceof Error ? `Booking run stopped: ${error.message}` : 'Booking run stopped by an error.',
      );
    } finally {
      if (stopBulk.current)
        for (const id of allFixtureIds) {
          if (!results[id]) record(id, 'skipped', 'Stopped before this fixture was processed.');
        }
      setBulkRunning(false);
      void loadTournamentOptions(false);
    }
  };

  const runAction = async (
    fixture: ForgeFixtureView,
    team: ForgeTeamView,
    action: 'challenge' | 'accept' | 'withdraw' | 'reverse',
    matchPlace?: 0 | 1,
  ) => {
    const opponent = team.side === 'home' ? fixture.away : fixture.home;
    const verb =
      action === 'challenge'
        ? 'Send'
        : action === 'withdraw'
          ? 'Withdraw'
          : action === 'reverse'
            ? 'Reverse'
            : 'Accept';
    const prompt =
      action === 'challenge'
        ? `Send a Cup Rules challenge from ${team.name} to ${opponent.name} with ${team.name} ${matchPlace === 0 ? 'HOME' : matchPlace === 1 ? 'AWAY' : team.side.toUpperCase()}?${matchPlace !== undefined && matchPlace !== (team.side === 'home' ? 0 : 1) ? '\n\nThis reverses the planned fixture venue and will be reported as a venue mismatch until the fixture is corrected.' : ''}`
        : action === 'reverse'
          ? `Reverse the saved fixture so ${fixture.away.name} becomes home and ${fixture.home.name} becomes away?\n\nThis changes the fixture for everyone, but does not send or accept a Hattrick challenge.`
          : action === 'withdraw'
            ? `Withdraw ${team.name}'s pending challenge to ${opponent.name}?`
            : `Accept the pending challenge from ${opponent.name} for ${team.name}?`;
    if (!window.confirm(`${prompt}\n\nThis performs a real Hattrick action.`)) return;

    const tournamentId = selectedTournamentId;
    const roundNumber = data?.currentRound?.roundNumber;
    const epoch = loadEpoch.current;
    if (!roundNumber || lockedFixtures.current.has(fixture.id)) return;
    lockedFixtures.current.add(fixture.id);
    fixtureVersions.current.set(fixture.id, (fixtureVersions.current.get(fixture.id) || 0) + 1);
    setBusyActions((current) => ({ ...current, [fixture.id]: true }));
    setFixtureErrors((current) => {
      const next = { ...current };
      delete next[fixture.id];
      return next;
    });
    setFixtureMessages((current) => {
      const next = { ...current };
      delete next[fixture.id];
      return next;
    });
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
          ...(matchPlace === undefined ? {} : { matchPlace }),
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
          if (!refreshResponse.ok)
            refreshNote = ' Local fixture refresh did not complete; use Refresh Fixtures to reconcile it.';
        } catch {
          refreshNote = ' Local fixture refresh did not complete; reload or use Refresh Fixtures to reconcile it.';
        }
      }
      if (loadEpoch.current !== epoch) return;
      setFixtureMessages((current) => ({
        ...current,
        [fixture.id]: `${payload.action?.message || `${verb} action completed.`}${refreshNote}`,
      }));
    } catch (actionError) {
      actionFailure = actionError instanceof Error ? actionError.message : `${verb} action failed.`;
    } finally {
      lockedFixtures.current.delete(fixture.id);
      if (loadEpoch.current === epoch) {
        await checkFixtures(tournamentId, roundNumber, [fixture.id], epoch);
        if (actionFailure) setFixtureErrors((current) => ({ ...current, [fixture.id]: actionFailure! }));
        setBusyActions((current) => {
          const next = { ...current };
          delete next[fixture.id];
          return next;
        });
      }
    }
  };

  const visibleFixtureCount =
    data?.fixtures?.filter((fixture) => visibleStatuses[fixtureStatusFilter(fixture.status)]).length ?? 0;

  return (
    <section className={styles.page}>
      <div className={styles.bookingLayout}>
        <div className={styles.bookingMain}>
          <SectionCard title="Match booking" className={styles.surfaceCard}>
            <div className={styles.toolbar}>
              <label className={styles.label} htmlFor="forge-matches-tournament">
                Tournament
              </label>
              <select
                id="forge-matches-tournament"
                className={styles.select}
                value={selectedTournamentId}
                disabled={bulkRunning || autoBookingBusy}
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
            {selectedTournamentId && (
              <div className={styles.autoBookingSetting}>
                <label htmlFor="forge-auto-booking">Automatic booking</label>
                <input
                  id="forge-auto-booking" type="checkbox" role="switch"
                  checked={autoBooking === true}
                  disabled={autoBooking === null || autoBookingBusy}
                  onChange={(event) => void saveAutoBooking(event.target.checked)}
                />
                <span>{autoBooking === null ? 'Loading…' : autoBookingBusy ? 'Saving…' : autoBooking ? 'On' : 'Off'}</span>
                {autoBookingError && <p className={styles.error} role="alert">{autoBookingError}</p>}
                <small>Saved for this season. Scheduled booking is not active yet.</small>
              </div>
            )}
            {!loading && !error && selectedTournamentId && data?.roundOptions && data.roundOptions.length > 0 && (
              <div className={styles.toolbar}>
                <label className={styles.label} htmlFor="forge-matches-round">
                  Round
                </label>
                <select
                  id="forge-matches-round"
                  className={styles.select}
                  value={selectedRoundNumber || data.currentRound?.roundNumber || ''}
                  disabled={bulkRunning}
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
                      {round.roundLabel || `Round ${round.roundNumber}`} ({round.fixtureCount} matches)
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
                          {tournament.currentRoundNumber && (
                            <span>{tournament.currentRoundLabel || `Round ${tournament.currentRoundNumber}`}</span>
                          )}
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
                  <div className={styles.roundTitleGroup}>
                    <h2 className={styles.roundTitle}>{data.tournament?.name}</h2>
                    {data.tournament?.slug && (
                    <a
                      className={styles.roundTournamentLink}
                      href={`/en/t/${encodeURIComponent(data.tournament.slug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      /t/{data.tournament.slug}
                    </a>
                    )}
                  </div>
                  <div className={styles.roundActions}>
                    <span className={styles.roundMeta}>
                      {data.currentRound.roundLabel || `Round ${data.currentRound.roundNumber}`}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loading || refreshingData || bulkRunning || Object.keys(busyActions).length > 0}
                      onClick={() => exportRoundCsv(data, fixtureErrors)}
                    >
                      Export CSV
                    </Button>
                    <Button
                      variant="primaryAction"
                      size="sm"
                      disabled={
                        bulkRunning ||
                        loading ||
                        refreshingData ||
                        Object.keys(busyActions).length > 0 ||
                        data.currentRound.phaseStatus !== 'materialized'
                      }
                      onClick={() => void bookAll()}
                    >
                      Book all
                    </Button>
                    {bulkRunning && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          stopBulk.current = true;
                        }}
                      >
                        Stop
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loading || refreshingData || bulkRunning || Object.keys(busyActions).length > 0}
                      onClick={() => void refreshData()}
                    >
                      <ArrowClockwise size={16} />
                      {refreshingData ? 'Refreshing...' : 'Refresh data'}
                    </Button>
                  </div>
                </div>
                {bulkProgress && (
                  <div className={styles.bulkProgress} role="status" aria-live="polite">
                    <strong>{bulkProgress}</strong>
                    <span>
                      {(['booked', 'pending', 'skipped', 'failed'] as const)
                        .map(
                          (status) =>
                            `${status}: ${Object.values(bulkResults).filter((result) => result.status === status).length}`,
                        )
                        .join(' · ')}
                    </span>
                    {Object.entries(bulkResults)
                      .filter(([, result]) => result.status !== 'booked')
                      .map(([id, result]) => {
                        const index = data.fixtures?.findIndex((fixture) => fixture.id === id) ?? -1;
                        return (
                          <span key={id}>
                            Match {index + 1} · {result.status}: {result.reason}
                          </span>
                        );
                      })}
                  </div>
                )}
                {message && <p className={styles.success}>{message}</p>}
                <fieldset className={styles.fixtureFilters}>
                  <legend>Show matches</legend>
                  {FIXTURE_STATUS_FILTERS.map(({ status, label }) => (
                    <label key={status} className={styles.fixtureFilter}>
                      <input
                        type="checkbox"
                        checked={visibleStatuses[status]}
                        onChange={(event) =>
                          setVisibleStatuses((current) => ({ ...current, [status]: event.target.checked }))
                        }
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
                    const hasBye = isByeTeam(fixture.home) || isByeTeam(fixture.away);
                    return (
                      <article key={fixture.id} className={styles.fixture}>
                        <div className={styles.fixtureHeader}>
                          <span className={styles.fixtureNumber}>Match {index + 1}</span>
                          {fixture.status === 'not_arranged' &&
                            !fixture.completed &&
                            !fixture.htMatchId &&
                            fixture.home.htTeamId &&
                            fixture.away.htTeamId && (
                              <Button
                                variant="secondaryDanger"
                                size="sm"
                                disabled={fixtureBusy || bulkRunning}
                                onClick={() => void runAction(fixture, fixture.home, 'reverse')}
                              >
                                Reverse home/away
                              </Button>
                            )}
                          {fixtureErrors[fixture.id] && (
                            <span role="alert" className={styles.error}>
                              {fixtureErrors[fixture.id]}{' '}
                              {!fixtureBusy && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (data.currentRound)
                                      void checkFixtures(
                                        selectedTournamentId,
                                        data.currentRound.roundNumber,
                                        [fixture.id],
                                        loadEpoch.current,
                                      );
                                  }}
                                >
                                  Retry check
                                </button>
                              )}
                            </span>
                          )}
                          {fixtureMessages[fixture.id] && (
                            <span role="status" className={styles.success}>
                              {fixtureMessages[fixture.id]}
                            </span>
                          )}
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
                                  {team.htTeamId ? (
                                    <a
                                      href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.htTeamId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {team.name}
                                    </a>
                                  ) : (
                                    <span>{team.name}</span>
                                  )}
                                </div>
                                {!isByeTeam(team) ? (
                                  <div className={styles.managerName}>
                                    {team.managerHtId && team.managerName ? (
                                      <a
                                        href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${team.managerHtId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        {team.managerName}
                                      </a>
                                    ) : (
                                      team.managerName || 'Manager unavailable'
                                    )}
                                  </div>
                                ) : null}
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
                              {!hasBye && (
                                <div className={styles.actions}>
                                  <Button
                                    variant="primaryAction"
                                    size="sm"
                                    disabled={!team.canChallenge || fixtureBusy || bulkRunning}
                                    title={
                                      team.canChallenge
                                        ? `Send a Cup Rules challenge to ${team.side === 'home' ? fixture.away.name : fixture.home.name}`
                                        : team.challengeDisabledReason
                                    }
                                    onClick={() => void runAction(fixture, team, 'challenge')}
                                  >
                                    Challenge {team.side === 'home' ? fixture.away.name : fixture.home.name}
                                  </Button>
                                  {team.side === 'away' && team.canChallenge && (
                                    <Button
                                      variant="secondaryDanger"
                                      size="sm"
                                      disabled={fixtureBusy || bulkRunning}
                                      onClick={() => void runAction(fixture, team, 'challenge', 0)}
                                    >
                                      Challenge as home
                                    </Button>
                                  )}
                                  {team.canWithdraw && (
                                    <Button
                                      variant="secondaryDanger"
                                      size="sm"
                                      disabled={fixtureBusy || bulkRunning}
                                      onClick={() => void runAction(fixture, team, 'withdraw')}
                                    >
                                      Withdraw challenge
                                    </Button>
                                  )}
                                  <Button
                                    variant="secondaryDanger"
                                    size="sm"
                                    disabled={!team.canAccept || fixtureBusy || bulkRunning}
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
                              )}
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
          <SectionCard title="Bookable matches" className={styles.surfaceCard}>
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
                        ? tournament.currentRoundLabel || `Round ${tournament.currentRoundNumber}`
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
