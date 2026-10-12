import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { HATTRICK_WORLD_DETAILS } from '../../../shared/worlddetails';
import { getCountryFlagEmoji } from '../../utils/ht-data';
import {
  FORGE_LEAGUE_TEAM_LIMIT,
  formatForgeLeagueOutreachMessage,
  leagueTeamStatus,
  managerMessageHref,
  type ForgeLeagueOption,
  type ForgeLeagueSnapshot,
  type ForgeLeagueTeam,
} from '../../utils/forge-leagues';
import styles from './ForgeLeagues.module.sass';

// Rounded cutoffs balance the number of small leagues in the menu.
const ranges = [
  { label: '1–115', min: 1, max: 115 },
  { label: '116–150', min: 116, max: 150 },
  { label: '151–200', min: 151, max: 200 },
  { label: '201–300', min: 201, max: 300 },
  { label: '301–800', min: 301, max: 800 },
  { label: '801–1200', min: 801, max: FORGE_LEAGUE_TEAM_LIMIT },
  { label: 'All (1–1200)', min: 1, max: FORGE_LEAGUE_TEAM_LIMIT },
];
const link = (kind: 'team' | 'manager' | 'league', id: number) =>
  `https://www.hattrick.org/goto.ashx?path=${
    kind === 'team'
      ? `/Club/?TeamID=${id}`
      : kind === 'manager'
        ? `/Club/Manager/?userId=${id}`
        : `/World/Leagues/?LeagueID=${id}`
  }`;
const supporterIcons: Record<string, string> = {
  silver: '📎',
  gold: '⭐️',
  platinum: '💍',
  diamond: '💎',
};

function formatLastSeen(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  const dayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' })
    .format(date).replaceAll('/', '.');
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${dayMonth} ${time}`;
}

interface SnapshotResponse {
  snapshot: ForgeLeagueSnapshot | null;
  revision: number;
}
interface WorkingList extends SnapshotResponse {
  dirty: boolean;
  saveId: string;
}
interface TeamBatch {
  results: Array<{ teamId: number; team?: ForgeLeagueTeam | null; error?: string }>;
}
const BATCH_SIZE = 3;
const draftKey = (id: number) => `forge-league-working-v2:${id}`;
const outreachStoragePrefix = 'forge-league-outreach-v1';
const defaultOutreachMessage = `Ia ora na, Bula and Håfa adai! 🌍

HT-120min (a CHPP product I’m part of) is launching [b]Around the World in One Twenty 🧳🌏[/b] — an international friendly cup exclusively only for [b]flag chasers with teams in smaller Hattrick countries[/b]. Bring one along, and your other teams are automatically welcome too!

The idea is to bring those teams together and look for opponents who can add [b]missing home or away flags[/b] to your collection. Matches can be automatically arranged, saving you the weekly search for a partner. Teams will be automatically paired with their missing home and away flags in mind, aiming to add something new to both collections whenever possible.

Extra time and its training benefits are welcome, but [b]120 minutes is not forced[/b]. Standings use averages, so you can join later or skip a round without having to catch up on missed rounds.

[b]Friendly still free this week?[/b] There may be room in the first round. Already booked? Join the waiting list for next week.

We'd love to see [b]{teamName} {teamFlag}[/b] among the first participants!

[link=https://ht-120min.vercel.app/en/t/around-the-world-in-one-twenty]

Comments and suggestions are welcome — this is the first trip, and the app is still in [i]beta[/i].

Best,
mr_bots
🏆 ⚽️`;
const emptyWorking = (): WorkingList => ({ snapshot: null, revision: 0, dirty: false, saveId: '' });

function browserDraft(id: number): WorkingList | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(id));
    if (!raw) return null;
    const data = JSON.parse(raw) as WorkingList;
    return data.dirty &&
      Number.isSafeInteger(data.revision) &&
      data.snapshot &&
      Array.isArray(data.snapshot.teams) &&
      data.snapshot.teams.length <= FORGE_LEAGUE_TEAM_LIMIT &&
      typeof data.saveId === 'string'
      ? data
      : null;
  } catch {
    return null;
  }
}

async function request<T>(
  action: string,
  leagueId?: number,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const params = new URLSearchParams({ tool: 'leagues', action });
  if (leagueId) params.set('leagueId', String(leagueId));
  const response = await fetch(`/api/testing?${params}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    cache: 'no-store',
    signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load league data.');
  return data as T;
}

export function ForgeLeagues() {
  const [leagues, setLeagues] = useState<ForgeLeagueOption[]>([]);
  const [range, setRange] = useState(0);
  const [leagueId, setLeagueId] = useState(0);
  const [saved, setSaved] = useState<WorkingList>(emptyWorking);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const [view, setView] = useState<'all' | 'available' | 'users'>('all');
  const [country, setCountry] = useState('');
  const [messageTemplate, setMessageTemplate] = useState(defaultOutreachMessage);
  const [messagedManagerIds, setMessagedManagerIds] = useState<number[]>([]);
  const [outreachOwnerId, setOutreachOwnerId] = useState<string | null>(null);
  const [loadedOutreachStorageKey, setLoadedOutreachStorageKey] = useState('');
  const stop = useRef(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const current = useRef(saved);
  const selection = useRef(0);
  const outreachStorageKey = outreachOwnerId ? `${outreachStoragePrefix}:${outreachOwnerId}` : '';
  const chooseLeague = useCallback((id: number) => {
    if (selection.current === id && id !== 0) return;
    selection.current = id;
    current.current = emptyWorking();
    setSaved(current.current);
    setLoading(id > 0);
    setError('');
    setNotice('');
    setStorageWarning('');
    setCountry('');
    setLeagueId(id);
  }, []);
  const accept = (data: WorkingList, id = leagueId) => {
    current.current = data;
    try {
      if (data.dirty) window.sessionStorage.setItem(draftKey(id), JSON.stringify(data));
      else window.sessionStorage.removeItem(draftKey(id));
    } catch {
      if (alive.current)
        setStorageWarning('Browser storage is unavailable. Keep this page open until the scan finishes.');
    }
    if (alive.current) setSaved(data);
  };

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    request<{ leagues: ForgeLeagueOption[] }>('catalogue', undefined, undefined, abort.signal)
      .then((data) => {
        if (abort.signal.aborted) return;
        const sorted = data.leagues
          .slice()
          .sort((a, b) => a.activeTeams - b.activeTeams || a.name.localeCompare(b.name));
        setLeagues(sorted);
        chooseLeague(sorted.find((item) => item.activeTeams <= ranges[0].max)?.leagueId || sorted[0]?.leagueId || 0);
        if (!sorted.some((item) => item.activeTeams <= ranges[0].max)) setRange(ranges.length - 1);
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not load leagues.');
          setLoading(false);
        }
      });
    return () => {
      alive.current = false;
      abort.abort();
      stop.current = true;
    };
  }, [chooseLeague]);

  useEffect(() => {
    let timer = 0;
    try {
      const ownerId = window.localStorage.getItem('my_ht_user_id') || 'unknown-manager';
      timer = window.setTimeout(() => setOutreachOwnerId(ownerId), 0);
    } catch {
      timer = window.setTimeout(() => setOutreachOwnerId('unknown-manager'), 0);
    }
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!outreachStorageKey) return;
    let timer = 0;
    try {
      const stored = window.localStorage.getItem(outreachStorageKey);
      if (stored) {
        const data = JSON.parse(stored) as { messageTemplate?: unknown; messagedManagerIds?: unknown };
        const storedTemplate = typeof data.messageTemplate === 'string' ? data.messageTemplate : null;
        const storedManagerIds = Array.isArray(data.messagedManagerIds)
          ? data.messagedManagerIds.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id))
          : null;
        timer = window.setTimeout(() => {
          if (storedTemplate !== null) setMessageTemplate(storedTemplate);
          if (storedManagerIds !== null) setMessagedManagerIds(storedManagerIds);
          setLoadedOutreachStorageKey(outreachStorageKey);
        }, 0);
      } else {
        timer = window.setTimeout(() => setLoadedOutreachStorageKey(outreachStorageKey), 0);
      }
    } catch {
      // Outreach state is a convenience; keep the editable default if storage is unavailable.
      timer = window.setTimeout(() => setLoadedOutreachStorageKey(outreachStorageKey), 0);
    }
    return () => window.clearTimeout(timer);
  }, [outreachStorageKey]);

  useEffect(() => {
    if (!outreachStorageKey || loadedOutreachStorageKey !== outreachStorageKey) return;
    try {
      window.localStorage.setItem(outreachStorageKey, JSON.stringify({ messageTemplate, messagedManagerIds }));
    } catch {
      // Copying still works when browser storage is unavailable.
    }
  }, [messageTemplate, messagedManagerIds, loadedOutreachStorageKey, outreachStorageKey]);

  useEffect(() => {
    if (!leagueId) return;
    const abort = new AbortController();
    Promise.resolve(browserDraft(leagueId))
      .then(async (draft) => {
        if (draft) return draft;
        const data = await request<SnapshotResponse>('snapshot', leagueId, undefined, abort.signal);
        // Older persisted scan jobs can be resumed locally without more DB checkpoints.
        return { ...data, dirty: Boolean(data.snapshot?.job), saveId: data.snapshot?.job ? crypto.randomUUID() : '' };
      })
      .then((data) => {
        if (!abort.signal.aborted) {
          current.current = data;
          setSaved(data);
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load the saved list.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [leagueId]);

  const pause = (cancel: boolean) => {
    stop.current = true;
    setNotice(
      cancel
        ? 'Cancelled. Progress remains in this browser tab; no snapshot was saved.'
        : 'Paused. Progress remains in this browser tab; no snapshot was saved.',
    );
  };

  const saveCompleted = async (data: WorkingList) => {
    if (!data.snapshot || data.snapshot.job || !data.dirty) return;
    if (alive.current) {
      setSaving(true);
      setNotice('Saving completed snapshot…');
    }
    try {
      const response = await request<SnapshotResponse>('save', leagueId, {
        snapshot: data.snapshot,
        revision: data.revision,
        saveId: data.saveId,
      });
      accept({ ...response, dirty: false, saveId: data.saveId });
      if (alive.current) {
        setLeagues((list) => list.map((item) => (item.leagueId === leagueId ? { ...item, fetched: true } : item)));
        setNotice('Finished. One snapshot saved.');
      }
    } catch (err) {
      if (alive.current) setNotice('Save failed. Completed results remain in this browser tab.');
      throw err;
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const retrySave = async () => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setError('');
    try {
      await saveCompleted(current.current);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Could not save results.');
    } finally {
      busy.current = false;
      if (alive.current) setRunning(false);
    }
  };

  const reloadSaved = async () => {
    if (busy.current || !window.confirm('Discard this tab’s unsaved results and load the saved database list?')) return;
    busy.current = true;
    setRunning(true);
    try {
      const data = await request<SnapshotResponse>('snapshot', leagueId);
      accept({ ...data, dirty: Boolean(data.snapshot?.job), saveId: data.snapshot?.job ? crypto.randomUUID() : '' });
      if (alive.current) {
        setError('');
        setNotice('Loaded the saved list.');
      }
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Could not reload the list.');
    } finally {
      busy.current = false;
      if (alive.current) setRunning(false);
    }
  };

  const scan = async (action: 'populate' | 'availability' | 'precise' | 'step') => {
    if (busy.current || loading || !leagueId) return;
    if (
      action === 'populate' &&
      saved.snapshot?.teams.length &&
      !window.confirm(
        'Rebuild this league’s team list? The saved list will be replaced only when the new scan finishes.',
      )
    )
      return;
    busy.current = true;
    stop.current = false;
    setRunning(true);
    setError('');
    setNotice('');
    try {
      let data = current.current;
      if (action === 'populate') {
        const { seriesIds } = await request<{ seriesIds: number[] }>('populate', leagueId, {});
        data = {
          snapshot: {
            teams: [],
            populatedAt: null,
            availabilityAt: null,
            populationComplete: false,
            job: { mode: 'populate', cursor: 0, total: 0, seriesIds, seriesCursor: 0, candidates: [] },
          },
          revision: data.revision,
          dirty: true,
          saveId: crypto.randomUUID(),
        };
        accept(data);
      } else if (action !== 'step') {
        if (!data.snapshot?.populationComplete) throw new Error('Finish populating the team list first.');
        const snapshot = structuredClone(data.snapshot);
        for (const team of snapshot.teams)
          Object.assign(team, { booked: null, inCup: null, checkedAt: null, error: null });
        snapshot.availabilityAt = null;
        delete snapshot.availabilityMethod;
        snapshot.job = {
          mode: action,
          cursor: 0,
          total: snapshot.teams.length,
          seriesIds: [],
          seriesCursor: 0,
          candidates: [],
        };
        data = { snapshot, revision: data.revision, dirty: true, saveId: crypto.randomUUID() };
        accept(data);
      }
      while (!stop.current && data.snapshot?.job) {
        const snapshot = structuredClone(data.snapshot);
        const job = snapshot.job!;
        if (job.mode === 'populate') {
          if (job.candidates.length) {
            const teamIds = job.candidates.slice(0, BATCH_SIZE);
            const batch = await request<TeamBatch>('teams', leagueId, { teamIds });
            for (const result of batch.results)
              if (result.team && !snapshot.teams.some((team) => team.teamId === result.teamId)) {
                if (snapshot.teams.length >= FORGE_LEAGUE_TEAM_LIMIT)
                  throw new Error('This league exceeds the team limit.');
                snapshot.teams.push(result.team);
              }
            job.candidates.splice(0, teamIds.length);
            job.cursor += teamIds.length;
          } else if (job.seriesCursor < job.seriesIds.length) {
            const seriesIds = job.seriesIds.slice(job.seriesCursor, job.seriesCursor + BATCH_SIZE);
            const batch = await request<{ candidateIds: number[] }>('series', leagueId, { seriesIds });
            job.candidates = batch.candidateIds.filter((id) => !snapshot.teams.some((team) => team.teamId === id));
            job.total += job.candidates.length;
            job.seriesCursor += seriesIds.length;
          }
          if (!job.candidates.length && job.seriesCursor >= job.seriesIds.length) {
            snapshot.populationComplete = true;
            snapshot.populatedAt = new Date().toISOString();
            snapshot.job = null;
          }
        } else {
          const teamIds = snapshot.teams.slice(job.cursor, job.cursor + BATCH_SIZE).map((team) => team.teamId);
          if (teamIds.length) {
            const batch = await request<TeamBatch>(job.mode, leagueId, { teamIds });
            let removed = 0;
            for (const result of batch.results) {
              const index = snapshot.teams.findIndex((team) => team.teamId === result.teamId);
              if (index < 0) continue;
              if (result.error)
                Object.assign(snapshot.teams[index], {
                  booked: null,
                  inCup: null,
                  checkedAt: new Date().toISOString(),
                  error: result.error,
                });
              else if (result.team) snapshot.teams[index] = result.team;
              else {
                snapshot.teams.splice(index, 1);
                removed += 1;
              }
            }
            job.cursor += teamIds.length - removed;
            job.total -= removed;
          }
          if (job.cursor >= snapshot.teams.length) {
            snapshot.availabilityAt = new Date().toISOString();
            snapshot.availabilityMethod = job.mode === 'precise' ? 'matches' : 'teamdetails';
            snapshot.job = null;
          }
        }
        data = { ...data, snapshot, dirty: true };
        accept(data);
        if (!alive.current) break;
      }
      if (alive.current && !stop.current && data.snapshot && !data.snapshot.job) await saveCompleted(data);
    } catch (err) {
      if (alive.current)
        setError(err instanceof Error ? err.message : 'Scan failed. Progress remains in this browser tab.');
    } finally {
      busy.current = false;
      if (alive.current) setRunning(false);
    }
  };

  const league = leagues.find((item) => item.leagueId === leagueId);
  const snapshot = saved.snapshot;
  const job = snapshot?.job;
  const options = leagues.filter(
    (item) => item.activeTeams >= ranges[range].min && item.activeTeams <= ranges[range].max,
  );
  const countries = [
    ...new Set(snapshot?.teams.map((team) => team.countryId).filter((id): id is number => id !== null) || []),
  ];
  const special = league && HATTRICK_WORLD_DETAILS[league.leagueId]?.countryId === null;
  const teams = (snapshot?.teams || [])
    .filter((team) => !country || String(team.countryId) === country)
    .filter((team) => view !== 'available' || leagueTeamStatus(team) === 'Available')
    .slice()
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
  const managers = new Map<number, ForgeLeagueTeam[]>();
  for (const team of teams) managers.set(team.managerId, [...(managers.get(team.managerId) || []), team]);
  const teamFlagFor = getCountryFlagEmoji;
  const copyManagerMessage = async (team: ForgeLeagueTeam) => {
    const teamFlag = teamFlagFor(team.countryId);
    const message = formatForgeLeagueOutreachMessage(messageTemplate, team, teamFlag);
    try {
      await navigator.clipboard.writeText(message);
      setMessagedManagerIds((ids) => (ids.includes(team.managerId) ? ids : [...ids, team.managerId]));
      setNotice(`Message copied for ${team.managerName || team.teamName}.`);
      setError('');
    } catch {
      setError('Could not copy the message. Check clipboard permissions and try again.');
    }
  };
  const messageManager = (team: ForgeLeagueTeam) => {
    void copyManagerMessage(team);
    window.open(managerMessageHref(team.managerId), '_blank', 'noopener,noreferrer');
  };
  const teamRow = (team: ForgeLeagueTeam, showManager: boolean) => {
    const status = leagueTeamStatus(team);
    const flag = teamFlagFor(team.countryId);
    const messaged = messagedManagerIds.includes(team.managerId);
    const lastSeen = formatLastSeen(team.lastLoginDate);
    const managerFlag = teamFlagFor(team.managerCountryId ?? null);
    return (
      <li key={team.teamId} className={styles.row}>
        <div>
          <a href={link('team', team.teamId)} target="_blank" rel="noreferrer">
            {flag} {team.teamName} · {team.teamId}
          </a>
          {showManager && (
            <a className={styles.meta} href={link('manager', team.managerId)} target="_blank" rel="noreferrer">
              {team.managerName}{managerFlag}{supporterIcons[team.supporterTier?.toLowerCase() || ''] || ''} · {team.managerId}
              {lastSeen && <> · Seen: {lastSeen}</>}
            </a>
          )}
        </div>
        <div className={styles.status}>
          <span
            className={
              status === 'Available' ? styles.available : status === 'Unknown' ? styles.meta : styles.unavailable
            }
          >
            {status}
          </span>
          <span className={styles.meta}>
            {team.checkedAt ? `Checked ${new Date(team.checkedAt).toLocaleString()}` : 'Not checked'}
          </span>
          {team.error && <span className={styles.meta}>{team.error}</span>}
        </div>
        <Button
          variant="secondary"
          size="sm"
          className={messaged ? styles.messaged : ''}
          disabled={messaged}
          onClick={() => messageManager(team)}
          aria-label={
            messaged
              ? `Messaged ${team.managerName || team.managerId}`
              : `Copy message for ${team.managerName || team.managerId}`
          }
        >
          {messaged ? '✓ Messaged' : 'Message'}
        </Button>
      </li>
    );
  };

  return (
    <section className={styles.page}>
      <SectionCard
        title="Leagues"
        subtitle={`Find friendly opportunities in leagues with up to ${FORGE_LEAGUE_TEAM_LIMIT} active teams.`}
      >
        <label className={styles.messageTemplate}>
          Outreach message
          <span className={styles.meta}>
            Use {'{teamName}'}, {'{managerName}'}, and {'{teamFlag}'} as substitutions. Clicking Message copies the filled text.
          </span>
          <textarea value={messageTemplate} onChange={(event) => setMessageTemplate(event.target.value)} rows={18} />
        </label>
        <div className={styles.controls}>
          <label>
            Active teams
            <select
              value={range}
              disabled={loading || running}
              onChange={(event) => {
                const next = Number(event.target.value);
                setRange(next);
                const candidates = leagues.filter(
                  (item) => item.activeTeams >= ranges[next].min && item.activeTeams <= ranges[next].max,
                );
                chooseLeague(candidates[0]?.leagueId || 0);
              }}
            >
              {ranges.map((item, index) => (
                <option key={item.label} value={index}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            League
            <select
              value={leagueId}
              disabled={loading || running}
              onChange={(event) => chooseLeague(Number(event.target.value))}
            >
              {!options.length && <option value={0}>No leagues in this range</option>}
              {options.map((item) => (
                <option key={item.leagueId} value={item.leagueId}>
                  {item.name} {HATTRICK_WORLD_DETAILS[item.leagueId]?.emoji} ({item.activeTeams})
                  {item.fetched ? ' · Fetched' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {league && (
          <p>
            <a href={link('league', league.leagueId)} target="_blank" rel="noreferrer">
              {league.name} {HATTRICK_WORLD_DETAILS[league.leagueId]?.emoji} ↗
            </a>
            <br />
            LeagueID: {league.leagueId} · Active teams: {league.activeTeams}
          </p>
        )}
        <div className={styles.buttons}>
          <Button
            variant="secondary"
            size="sm"
            disabled={!league || loading || running}
            onClick={() => void scan('populate')}
          >
            {snapshot?.populatedAt || job?.mode === 'populate' ? 'Rebuild team list' : 'Populate team list'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || running || !snapshot?.populationComplete || !snapshot.teams.length}
            onClick={() => void scan('availability')}
          >
            {snapshot?.availabilityAt ? 'Refresh availability' : 'Check next-match status'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || running || !snapshot?.populationComplete || !snapshot.teams.length}
            onClick={() => void scan('precise')}
          >
            Precise check (matches)
          </Button>
          {!running && saved.dirty && snapshot?.populationComplete && !job && (
            <Button variant="secondary" size="sm" disabled={loading} onClick={() => void retrySave()}>
              Save results
            </Button>
          )}
          {!running && job && (
            <Button variant="secondary" size="sm" disabled={loading} onClick={() => void scan('step')}>
              Continue scan
            </Button>
          )}
          {running && (
            <>
              <Button variant="secondary" size="sm" disabled={saving} onClick={() => pause(false)}>
                Pause
              </Button>
              <Button variant="secondaryDanger" size="sm" disabled={saving} onClick={() => pause(true)}>
                Cancel scan
              </Button>
            </>
          )}
        </div>
        <div aria-live="polite" className={styles.meta}>
          {loading && <p>Loading…</p>}
          {job && (
            <p>
              {job.mode === 'populate'
                ? `Population: ${job.seriesCursor}/${job.seriesIds.length} series · ${job.cursor}/${job.total} discovered candidates checked · ${snapshot?.teams.length} teams listed`
                : `Availability: ${job.cursor}/${job.total} checked`}
              {running ? '' : ' · Stopped'}
            </p>
          )}
          {snapshot?.populatedAt && <p>List populated {new Date(snapshot.populatedAt).toLocaleString()}</p>}
          {snapshot?.availabilityAt && (
            <p>
              Availability checked {new Date(snapshot.availabilityAt).toLocaleString()} ·{' '}
              {snapshot.availabilityMethod === 'matches'
                ? 'Matches check'
                : snapshot.availabilityMethod === 'teamdetails'
                  ? 'Teamdetails check'
                  : 'Previous check'}
            </p>
          )}
          {notice && <p>{notice}</p>}
        </div>
        {saved.dirty && (
          <p className={styles.meta}>
            Working results are kept in this browser tab. The database snapshot is saved once when the operation
            finishes.
          </p>
        )}
        {storageWarning && <p className={styles.unavailable}>{storageWarning}</p>}
        {error && (
          <p role="alert" className={styles.unavailable}>
            {error}
          </p>
        )}
        {!running && saved.dirty && error.includes('changed in another tab') && (
          <Button variant="secondary" size="sm" onClick={() => void reloadSaved()}>
            Reload saved list
          </Button>
        )}
        {!loading && !leagues.length && (
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            Retry loading leagues
          </Button>
        )}
      </SectionCard>
      {snapshot && (
        <SectionCard
          title={
            view === 'available'
              ? `Available in ${league?.name || 'this league'} • ${teams.length} teams`
              : `${saved.dirty ? 'Working list' : 'Saved list'} · ${snapshot.teams.length} teams`
          }
        >
          <div className={styles.buttons}>
            {(['all', 'available', 'users'] as const).map((item) => (
              <Button
                key={item}
                size="sm"
                variant={view === item ? 'primary' : 'secondary'}
                aria-pressed={view === item}
                onClick={() => setView(item)}
              >
                {item === 'all' ? 'All teams' : item === 'available' ? 'Available' : 'Users'}
              </Button>
            ))}
          </div>
          {special && countries.length > 1 && (
            <label className={styles.country}>
              Team country
              <select value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value="">All countries</option>
                {countries.map((id) => (
                  <option key={id} value={id}>
                    {Object.values(HATTRICK_WORLD_DETAILS).find((item) => item.countryId === id)?.countryNameEn || id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!snapshot.populationComplete && (
            <p className={styles.meta}>Partial team list. Continue population to finish discovering this league.</p>
          )}
          {view === 'available' && (
            <p className={styles.meta}>
              Only teams confirmed not booked and not in cup. Results reflect their last check.
            </p>
          )}
          {!teams.length && (
            <p className={styles.meta}>
              {view === 'available' ? 'No confirmed available teams in this list.' : 'No teams listed yet.'}
            </p>
          )}
          {view === 'users' ? (
            [...managers.entries()].map(([id, clubs]) => (
              <article key={id} className={styles.manager}>
                <a href={link('manager', id)} target="_blank" rel="noreferrer">
                  <strong>
                    {clubs[0].managerName} · {id}
                  </strong>
                </a>
                <ul className={styles.list}>{clubs.map((team) => teamRow(team, false))}</ul>
              </article>
            ))
          ) : (
            <ul className={styles.list}>{teams.map((team) => teamRow(team, true))}</ul>
          )}
        </SectionCard>
      )}
    </section>
  );
}
