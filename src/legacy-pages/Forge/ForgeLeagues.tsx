import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { HATTRICK_WORLD_DETAILS } from '../../../shared/worlddetails';
import { getCountryFlagEmoji } from '../../utils/ht-data';
import {
  FORGE_LEAGUE_TEAM_LIMIT,
  formatForgeLeagueOutreachMessage,
  getForgeOutreachStatus,
  leagueTeamStatus,
  managerMessageHref,
  type ForgeOutreachCampaign,
  type ForgeOutreachContact,
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
const leagueDisplayName = (leagueId: number, fallback: string) =>
  HATTRICK_WORLD_DETAILS[leagueId]?.leagueName || fallback;
const supporterIcons: Record<string, string> = {
  silver: '💍',
  gold: '⭐️',
  platinum: '🪩',
  diamond: '💎',
};

function parseLastSeen(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLastSeen(value?: string | null): string | null {
  const date = parseLastSeen(value);
  if (!date) return null;
  const dayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' })
    .format(date)
    .replaceAll('/', '.');
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
const currentCampaignId = 'around-the-world-in-one-twenty';
const defaultOutreachMessage = `Ia ora na, Bula and Håfa adai! 🌍

HT-120min (a CHPP product I’m part of) is launching [b]Around the World in One Twenty 🧳🌏[/b] — an international friendly cup exclusively only for [b]flag chasers with teams in smaller Hattrick countries[/b]. Bring one along, and your other teams are automatically welcome too!

The idea is to bring those teams together and look for opponents who can add [b]missing home or away flags[/b] to your collection. Matches can be automatically arranged, saving you the weekly search for a partner. Teams will be automatically paired with their missing home and away flags in mind, aiming to add something new to both collections whenever possible.

Extra time and its training benefits are welcome, but [b]120 minutes is not forced[/b]. Standings use averages, so you can join later or skip a round without having to catch up on missed rounds.

[b]Friendly still free this week?[/b] There may be room in the first round. Already booked? Join the waiting list for next week.

We'd love to see [b]{teamName} {teamFlag}[/b]{otherTeams} among the first participants!

[link=https://ht-120min.vercel.app/en/t/around-the-world-in-one-twenty]

Comments and suggestions are welcome — this is the first trip, and the app is still in [i]beta[/i].

Best,
mr_bots
🏆 ⚽️`;
const emptyWorking = (): WorkingList => ({ snapshot: null, revision: 0, dirty: false, saveId: '' });
const upgradeOutreachTemplate = (template: string) =>
  template.replace(
    "We'd love to see [b]{teamName} {teamFlag}[/b] among the first participants!",
    "We'd love to see [b]{teamName} {teamFlag}[/b]{otherTeams} among the first participants!",
  );

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
  const [view, setView] = useState<'all' | 'available'>('all');
  const [supportersOnly, setSupportersOnly] = useState(false);
  const [activeRecently, setActiveRecently] = useState(false);
  const [sortByRecentActivity, setSortByRecentActivity] = useState(false);
  const [country, setCountry] = useState('');
  const [messageTemplate, setMessageTemplate] = useState(defaultOutreachMessage);
  const [outreachCampaigns, setOutreachCampaigns] = useState<ForgeOutreachCampaign[]>([]);
  const [outreachContacts, setOutreachContacts] = useState<ForgeOutreachContact[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(currentCampaignId);
  const [outreachNoteName, setOutreachNoteName] = useState('');
  const [outreachNoteDate, setOutreachNoteDate] = useState('');
  const [outreachLoaded, setOutreachLoaded] = useState(false);
  const [outreachError, setOutreachError] = useState('');
  const [outreachBusy, setOutreachBusy] = useState(false);
  const [messagingManagerIds, setMessagingManagerIds] = useState<number[]>([]);
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
          .sort(
            (a, b) =>
              a.activeTeams - b.activeTeams ||
              leagueDisplayName(a.leagueId, a.name).localeCompare(leagueDisplayName(b.leagueId, b.name)),
          );
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
        const data = JSON.parse(stored) as { messageTemplate?: unknown };
        if (typeof data.messageTemplate === 'string') {
          timer = window.setTimeout(() => {
            setMessageTemplate(upgradeOutreachTemplate(data.messageTemplate as string));
            setLoadedOutreachStorageKey(outreachStorageKey);
          }, 0);
        } else timer = window.setTimeout(() => setLoadedOutreachStorageKey(outreachStorageKey), 0);
      } else timer = window.setTimeout(() => setLoadedOutreachStorageKey(outreachStorageKey), 0);
    } catch {
      timer = window.setTimeout(() => setLoadedOutreachStorageKey(outreachStorageKey), 0);
    }
    return () => window.clearTimeout(timer);
  }, [outreachStorageKey]);

  useEffect(() => {
    if (!outreachStorageKey || loadedOutreachStorageKey !== outreachStorageKey) return;
    try {
      const raw = window.localStorage.getItem(outreachStorageKey);
      const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      // Preserve the existing local manager IDs unchanged until the import count is verified.
      window.localStorage.setItem(outreachStorageKey, JSON.stringify({ ...data, messageTemplate }));
    } catch {
      // The database-backed contact record is independent of browser storage.
    }
  }, [messageTemplate, loadedOutreachStorageKey, outreachStorageKey]);

  useEffect(() => {
    const abort = new AbortController();
    request<{ campaigns: ForgeOutreachCampaign[]; contacts: ForgeOutreachContact[] }>(
      'outreach',
      undefined,
      undefined,
      abort.signal,
    )
      .then((data) => {
        if (abort.signal.aborted) return;
        setOutreachCampaigns(data.campaigns);
        setOutreachContacts(data.contacts);
        const initial = data.campaigns[0] || data.campaigns.find((item) => item.id === currentCampaignId);
        if (initial) {
          setSelectedCampaignId(initial.id);
          setOutreachNoteName(initial.name);
          setOutreachNoteDate(initial.campaignDate);
        }
        setOutreachLoaded(true);
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          setOutreachError(err instanceof Error ? err.message : 'Could not load outreach history.');
          setOutreachLoaded(true);
        }
      });
    return () => abort.abort();
  }, []);

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
                  otherTeams: [],
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
  const activeSince = Date.now() - 8 * 24 * 60 * 60 * 1000;
  const teams = (snapshot?.teams || [])
    .filter((team) => !country || String(team.countryId) === country)
    .filter((team) => view !== 'available' || leagueTeamStatus(team) === 'Available')
    .filter((team) => !supportersOnly || Boolean(supporterIcons[team.supporterTier?.toLowerCase() || '']))
    .filter((team) => {
      if (!activeRecently) return true;
      const lastSeen = parseLastSeen(team.lastLoginDate);
      return Boolean(lastSeen && lastSeen.getTime() <= Date.now() && lastSeen.getTime() >= activeSince);
    })
    .slice()
    .sort((a, b) => {
      if (sortByRecentActivity) {
        const aLastSeen = parseLastSeen(a.lastLoginDate)?.getTime() ?? -Infinity;
        const bLastSeen = parseLastSeen(b.lastLoginDate)?.getTime() ?? -Infinity;
        if (aLastSeen !== bLastSeen) return bLastSeen - aLastSeen;
      }
      return a.teamName.localeCompare(b.teamName);
    });
  const teamFlagFor = getCountryFlagEmoji;
  const namedTeamWithFlag = (name: string, countryId: number | null) =>
    [teamFlagFor(countryId), name].filter(Boolean).join(' ');
  const smallLeagueIds = new Set(leagues.filter((item) => item.activeTeams <= 420).map((item) => item.leagueId));
  const selectedCampaign = outreachCampaigns.find((campaign) => campaign.id === selectedCampaignId);
  const outreachNoteDirty = Boolean(
    selectedCampaign &&
    (outreachNoteName.trim() !== selectedCampaign.name || outreachNoteDate !== selectedCampaign.campaignDate),
  );
  const saveOutreachNote = async () => {
    const name = outreachNoteName.trim();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(outreachNoteDate) || outreachBusy) return;
    const changedName = Boolean(selectedCampaign && name !== selectedCampaign.name);
    const slug =
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 72) || 'outreach-note';
    const campaignId = changedName ? `${slug}-${crypto.randomUUID().slice(0, 8)}` : selectedCampaignId;
    setOutreachBusy(true);
    setOutreachError('');
    try {
      await request('outreach-note', undefined, { campaignId, name, campaignDate: outreachNoteDate });
      const campaign = { id: campaignId, name, campaignDate: outreachNoteDate };
      setOutreachCampaigns((campaigns) => [campaign, ...campaigns.filter((item) => item.id !== campaignId)]);
      setSelectedCampaignId(campaignId);
      setOutreachNoteName(name);
      setNotice('Contact note saved.');
    } catch (err) {
      setOutreachError(err instanceof Error ? err.message : 'Could not save the contact note.');
    } finally {
      setOutreachBusy(false);
    }
  };
  const copyManagerMessage = async (team: ForgeLeagueTeam) => {
    if (!selectedCampaign || outreachBusy || !outreachLoaded || outreachNoteDirty) return;
    const teamFlag = teamFlagFor(team.countryId);
    const otherSmallTeams = (team.otherTeams || []).filter((other) => smallLeagueIds.has(other.leagueId));
    const otherTeams =
      otherSmallTeams.length > 2
        ? ' or any of your other small league teams'
        : otherSmallTeams.length === 2
          ? `, ${otherSmallTeams.map((other) => `[b]${namedTeamWithFlag(other.teamName, other.countryId)}[/b]`).join(' or ')}`
          : otherSmallTeams.length === 1
            ? ` or [b]${namedTeamWithFlag(otherSmallTeams[0].teamName, otherSmallTeams[0].countryId)}[/b]`
            : '';
    const message = formatForgeLeagueOutreachMessage(messageTemplate, team, teamFlag, otherTeams);
    setMessagingManagerIds((ids) => (ids.includes(team.managerId) ? ids : [...ids, team.managerId]));
    let copied = false;
    try {
      await navigator.clipboard.writeText(message);
      copied = true;
      await request('outreach-contact', undefined, {
        campaignId: selectedCampaign.id,
        managerId: team.managerId,
      });
      setOutreachContacts((contacts) =>
        contacts.some((contact) => contact.campaignId === selectedCampaign.id && contact.managerId === team.managerId)
          ? contacts
          : [...contacts, { campaignId: selectedCampaign.id, managerId: team.managerId }],
      );
      setNotice(`Message copied and recorded for ${team.managerName || team.teamName}.`);
      setError('');
    } catch (err) {
      setOutreachError(
        copied
          ? 'Message copied, but it was not recorded. Retry the contact action to save it.'
          : 'Could not copy the message. Check clipboard permissions and try again.',
      );
    } finally {
      setMessagingManagerIds((ids) => ids.filter((id) => id !== team.managerId));
    }
  };
  const messageManager = (team: ForgeLeagueTeam) => {
    void copyManagerMessage(team);
    window.open(managerMessageHref(team.managerId), '_blank', 'noopener,noreferrer');
  };
  const teamRow = (team: ForgeLeagueTeam) => {
    const status = leagueTeamStatus(team);
    const flag = teamFlagFor(team.countryId);
    const outreachStatus = getForgeOutreachStatus(
      selectedCampaignId,
      team.managerId,
      outreachCampaigns,
      outreachContacts,
    );
    const messaged = outreachStatus.contacted;
    const sending = messagingManagerIds.includes(team.managerId);
    const lastSeen = formatLastSeen(team.lastLoginDate);
    const managerFlag = teamFlagFor(team.managerCountryId ?? null);
    const otherTeamsLabel = (team.otherTeams || [])
      .map((other) => namedTeamWithFlag(other.teamName, other.countryId))
      .join(' · ');
    return (
      <li key={team.teamId} className={styles.row}>
        <div>
          <a href={link('team', team.teamId)} target="_blank" rel="noreferrer">
            {flag} {team.teamName} · {team.teamId}
          </a>
          <a className={styles.meta} href={link('manager', team.managerId)} target="_blank" rel="noreferrer">
            {team.managerName}
            {managerFlag}
            {supporterIcons[team.supporterTier?.toLowerCase() || ''] || ''} · {team.managerId}
            {lastSeen && <> · Seen: {lastSeen}</>}
          </a>
          {otherTeamsLabel && <span className={styles.meta}>{otherTeamsLabel}</span>}
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
        <div className={styles.messagedField}>
          {!messaged && outreachStatus.previousCampaignNames.length > 0 && (
            <span className={styles.meta}>Contacted: {outreachStatus.previousCampaignNames.join(', ')}</span>
          )}
          <Button
            variant="secondary"
            size="sm"
            className={messaged ? styles.messaged : ''}
            disabled={messaged || sending || !outreachLoaded || !selectedCampaign || outreachNoteDirty || outreachBusy}
            onClick={() => messageManager(team)}
            aria-label={
              messaged
                ? `Messaged ${team.managerName || team.managerId}`
                : `Copy message for ${team.managerName || team.managerId}`
            }
          >
            {messaged ? '✓ Messaged' : sending ? 'Copying…' : 'Message'}
          </Button>
        </div>
      </li>
    );
  };

  return (
    <section className={styles.page}>
      <SectionCard
        title="Leagues"
        subtitle={`Find friendly opportunities in leagues with up to ${FORGE_LEAGUE_TEAM_LIMIT} active teams.`}
      >
        <div className={styles.messageTemplate}>
          <div className={styles.outreachNote}>
            <label>
              Campaign name
              <input
                value={outreachNoteName}
                disabled={!outreachLoaded || outreachBusy}
                onChange={(event) => setOutreachNoteName(event.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={outreachNoteDate}
                disabled={!outreachLoaded || outreachBusy}
                onChange={(event) => setOutreachNoteDate(event.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              size="sm"
              disabled={!outreachLoaded || outreachBusy || !outreachNoteName.trim() || !outreachNoteDirty}
              onClick={() => void saveOutreachNote()}
            >
              {outreachBusy ? 'Saving…' : 'Save note'}
            </Button>
          </div>
          <label>
            <span className={styles.meta}>
              Use {'{teamName}'}, {'{managerName}'}, {'{teamFlag}'}, and {'{otherTeams}'} as substitutions. Clicking
              Message copies the filled text.
            </span>
            <textarea value={messageTemplate} onChange={(event) => setMessageTemplate(event.target.value)} rows={18} />
          </label>
          {outreachError && (
            <span className={styles.unavailable} role="alert">
              {outreachError}
            </span>
          )}
        </div>
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
                  {leagueDisplayName(item.leagueId, item.name)} {HATTRICK_WORLD_DETAILS[item.leagueId]?.emoji} (
                  {item.activeTeams}){item.fetched ? ' · Fetched' : ''}
                  {' · Msg: '}
                  {item.messagedManagerCounts?.[selectedCampaignId] || 0}
                </option>
              ))}
            </select>
          </label>
        </div>
        {league && (
          <p>
            <a href={link('league', league.leagueId)} target="_blank" rel="noreferrer">
              {leagueDisplayName(league.leagueId, league.name)} {HATTRICK_WORLD_DETAILS[league.leagueId]?.emoji} ↗
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
          title={`Teams in ${league ? leagueDisplayName(league.leagueId, league.name) : 'this league'} · ${teams.length}/${snapshot.teams.length}`}
        >
          <div className={styles.buttons}>
            {(['all', 'available'] as const).map((item) => (
              <Button
                key={item}
                size="sm"
                variant={view === item ? 'primary' : 'secondary'}
                aria-pressed={view === item}
                onClick={() => setView(item)}
              >
                {item === 'all' ? 'All teams' : 'Available'}
              </Button>
            ))}
            <label className={styles.filter}>
              <input
                type="checkbox"
                checked={supportersOnly}
                onChange={(event) => setSupportersOnly(event.target.checked)}
              />
              Supporters only
            </label>
            <label className={styles.filter}>
              <input
                type="checkbox"
                checked={activeRecently}
                onChange={(event) => setActiveRecently(event.target.checked)}
              />
              Active in past 8 days
            </label>
            <label className={styles.filter}>
              <input
                type="checkbox"
                checked={sortByRecentActivity}
                onChange={(event) => setSortByRecentActivity(event.target.checked)}
              />
              Online recently
            </label>
          </div>
          {special && countries.length > 1 && (
            <label className={styles.country}>
              Team country
              <select value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value="">All countries</option>
                {countries.map((id) => (
                  <option key={id} value={id}>
                    {Object.values(HATTRICK_WORLD_DETAILS).find((item) => item.countryId === id)?.leagueName || id}
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
              {view === 'available'
                ? 'No confirmed available teams match these filters.'
                : snapshot.teams.length
                  ? 'No teams match these filters.'
                  : 'No teams listed yet.'}
            </p>
          )}
          <ul className={styles.list}>{teams.map((team) => teamRow(team))}</ul>
        </SectionCard>
      )}
    </section>
  );
}
