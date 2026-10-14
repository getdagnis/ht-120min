import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { HATTRICK_WORLD_DETAILS, getCountryWorldDetails } from '../../../shared/worlddetails';
import {
  createFlagDraft, draftMetrics, pairBenefits, parseFlagSnapshot, reconcileFlagSnapshot,
  type FlagCollection, type FlagDraft, type FlagHunterTeam, type FlagSnapshot,
} from '../../../shared/flag-hunters';
import styles from './FlagHunters.module.sass';

const STORAGE_KEY = 'forge-flag-hunters-v1';
const endpoint = (slug: string) => `/api/testing?tool=flag-hunters&slug=${encodeURIComponent(slug)}`;
const leagueName = (id: number) => HATTRICK_WORLD_DETAILS[id]?.leagueName || `League ${id}`;
const displayError = (error: unknown) => error instanceof Error ? error.message : 'Request failed.';
const signature = (teams: FlagHunterTeam[]) => JSON.stringify(teams.map(team => [team.id, team.htTeamId, team.managerId, team.leagueId, team.flagCountryId]).sort());

export function FlagHunters() {
  const [slug, setSlug] = useState('around-the-world');
  const [snapshot, setSnapshot] = useState<FlagSnapshot | null>(null);
  const [title, setTitle] = useState('');
  const [loadedSlug, setLoadedSlug] = useState('around-the-world');
  const [draft, setDraft] = useState<FlagDraft | null>(null);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [seed, setSeed] = useState('round-one');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<number[]>([]);
  const current = useRef<FlagSnapshot | null>(null);
  const stop = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const commit = useCallback((next: FlagSnapshot) => {
    current.current = next;
    setSnapshot(next);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { setNotice('Browser storage is unavailable. Export the snapshot to retain progress.'); }
  }, []);

  const loadRoster = useCallback(async (requestedSlug: string) => {
    setBusy(true); setError(''); setNotice(''); setIssues({});
    const controller = new AbortController(); abort.current = controller;
    try {
      const response = await fetch(endpoint(requestedSlug), { credentials: 'include', cache: 'no-store', signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load participants.');
      if (!mounted.current) return;
      const teams = payload.teams as FlagHunterTeam[];
      let previous = current.current ? parseFlagSnapshot(current.current) : null;
      if (!previous) {
        let stored: string | null = null;
        try { stored = sessionStorage.getItem(STORAGE_KEY); } catch { setNotice('Browser storage is unavailable. Use JSON export to retain progress.'); }
        if (stored) { try { previous = parseFlagSnapshot(JSON.parse(stored)); } catch { setNotice('Saved snapshot could not be restored.'); } }
      }
      let flags: Record<string, FlagCollection> = {};
      if (previous?.tournamentId === payload.tournament.id) {
        const comparison = reconcileFlagSnapshot(previous, payload.tournament.id, teams);
        flags = comparison.flags;
        if (comparison.missing.length || comparison.departed.length || comparison.changed.length) {
          setNotice(`Roster changed: ${comparison.missing.length} new, ${comparison.departed.length} departed, ${comparison.changed.length} changed. Draft cleared.`);
        }
        if (signature(previous.teams) !== signature(teams)) setDraft(null);
      } else { setDraft(null); setExcludedIds([]); }
      setExcludedIds(ids => ids.filter(id => teams.some(team => team.htTeamId === id)));
      setTitle(payload.tournament.name); setLoadedSlug(requestedSlug);
      setSavedIds(Object.values(flags).map(item => item.htTeamId));
      commit({ version: 2, tournamentId: payload.tournament.id, savedAt: new Date().toISOString(), teams, flags });
      return true;
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) setError(displayError(failure));
      return false;
    } finally { if (mounted.current) setBusy(false); }
  }, [commit]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop.current = true; abort.current?.abort(); };
  }, []);

  const refreshFlags = async (ids: number[]) => {
    if (!current.current || !ids.length) return;
    setBusy(true); setError(''); stop.current = false;
    const controller = new AbortController(); abort.current = controller;
    const working = current.current;
    try {
      for (let i = 0; i < ids.length && !stop.current; i++) {
        const id = ids[i];
        setProgress(`Checking ${i + 1}/${ids.length}: ${working.teams.find(team => team.htTeamId === id)?.name || id}`);
        try {
          const response = await fetch(endpoint(loadedSlug), {
            method: 'POST', credentials: 'include', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ htTeamId: id }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || 'Flag retrieval failed.');
          if (!mounted.current) return;
          const latest = current.current!;
          const next = parseFlagSnapshot({ ...latest, savedAt: new Date().toISOString(),
            teams: latest.teams.map(team => team.htTeamId === id ? payload.team : team),
            flags: { ...latest.flags, [String(id)]: payload.flags } });
          if (signature(next.teams) !== signature(latest.teams)) setDraft(null);
          commit(next); // Persist immediately, not only at the end of the scan.
          setSavedIds(previous => previous.filter(item => item !== id));
          setIssues(previous => { const nextIssues = { ...previous }; delete nextIssues[String(id)]; return nextIssues; });
        } catch (failure) {
          if (controller.signal.aborted) return;
          if (mounted.current) {
            setIssues(previous => ({ ...previous, [String(id)]: displayError(failure) }));
            // A failed refresh preserves the prior successful snapshot but marks it unverified.
            setSavedIds(previous => previous.includes(id) ? previous : [...previous, id]);
          }
        }
      }
    } finally {
      if (mounted.current) { setBusy(false); setProgress(stop.current ? 'Paused. Successful results are saved.' : 'Refresh complete.'); }
    }
  };

  const importSnapshot = async (file: File | undefined) => {
    if (!file || !current.current) return;
    setError('');
    try {
      if (file.size > 1024 * 1024) throw new Error('Snapshot exceeds the 1 MB limit.');
      const imported = parseFlagSnapshot(JSON.parse(await file.text()));
      if (!await loadRoster(loadedSlug)) throw new Error('Could not verify the current roster. Snapshot was not imported.');
      const latest = current.current!;
      const comparison = reconcileFlagSnapshot(imported, latest.tournamentId, latest.teams);
      commit({ ...latest, flags: comparison.flags, savedAt: new Date().toISOString() });
      setSavedIds(Object.values(comparison.flags).map(item => item.htTeamId)); setIssues({});
      setNotice(`Imported saved data; refresh to verify. Missing team IDs: ${comparison.missing.join(', ') || 'none'}. Departed: ${comparison.departed.join(', ') || 'none'}. Changed: ${comparison.changed.join(', ') || 'none'}.`);
    } catch (failure) { setError(displayError(failure)); }
  };

  const exportSnapshot = () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `flag-hunters-${loadedSlug}.json`; anchor.click();
    URL.revokeObjectURL(url);
  };
  const copySnapshot = async () => {
    if (!snapshot) return;
    setError('');
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setNotice('Snapshot JSON copied.');
    } catch { setError('Could not copy JSON. Check clipboard permissions or use Export JSON.'); }
  };
  const pairingTeams = snapshot?.teams.filter(team => !excludedIds.includes(team.htTeamId)) || [];
  const generate = (nextSeed: string) => {
    if (!snapshot) return;
    try { setSeed(nextSeed); setDraft(createFlagDraft(pairingTeams, snapshot.flags, nextSeed)); setError(''); }
    catch (failure) { setError(displayError(failure)); }
  };
  const metrics = draft && snapshot ? draftMetrics(draft, snapshot.teams, snapshot.flags) : null;
  const teamName = (id: number) => snapshot?.teams.find(team => team.htTeamId === id)?.name || String(id);

  return <div className={styles.layout}>
    <SectionCard title="Flag Hunters" subtitle="Participant roster and round-one playground">
      <p>Randomized baseline with manager-safe opponents and missing-flag venue selection. Drafts stay in this playground.</p>
      <div className={styles.actions}>
        <label>Tournament slug <input value={slug} disabled={busy} onChange={event => setSlug(event.target.value)} /></label>
        <Button variant="outline" disabled={busy} onClick={() => void loadRoster(slug)}>Load current roster</Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {progress && <p role="status">{progress}</p>}
      {!snapshot && <p>Load the current roster to begin. No Hattrick requests run until you refresh flags.</p>}
      {snapshot && <>
        <h4>{title} · {snapshot.teams.length} participants</h4>
        <div className={styles.actions}>
          <Button disabled={busy || !snapshot.teams.length || slug.trim() === ''} onClick={() => void refreshFlags(snapshot.teams.map(team => team.htTeamId))}>Refresh all flags</Button>
          <Button variant="outline" disabled={busy || !snapshot.teams.some(team => !snapshot.flags[String(team.htTeamId)] || issues[String(team.htTeamId)] || savedIds.includes(team.htTeamId))}
            onClick={() => void refreshFlags(snapshot.teams.filter(team => !snapshot.flags[String(team.htTeamId)] || issues[String(team.htTeamId)] || savedIds.includes(team.htTeamId)).map(team => team.htTeamId))}>Fetch missing / retry / resume</Button>
          {busy && <Button variant="outline" onClick={() => { stop.current = true; }}>Pause after current fetch</Button>}
          <Button variant="outline" disabled={busy} onClick={exportSnapshot}>Export JSON</Button>
          <Button variant="outline" disabled={busy} onClick={() => void copySnapshot()}>Copy JSON</Button>
          <label>Import JSON <input type="file" accept="application/json,.json" disabled={busy} onChange={event => { void importSnapshot(event.target.files?.[0]); event.target.value = ''; }} /></label>
        </div>
        {savedIds.length > 0 && <p>Saved or previously fetched data for {savedIds.length} teams needs a live refresh. Draft benefits using it are provisional.</p>}
        <div className={styles.scroll}><table><caption>Admitted participants and flag collections</caption><thead><tr><th>Team</th><th>Manager</th><th>Country</th><th>Home flags</th><th>Away flags</th><th>Snapshot status</th><th>Exclude</th></tr></thead><tbody>
          {snapshot.teams.map(team => {
            const flags = snapshot.flags[String(team.htTeamId)];
            return <tr key={team.htTeamId}>
              <td><a href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.htTeamId}`} target="_blank" rel="noreferrer">{getCountryWorldDetails(team.countryId)?.emoji || '🌐'} {team.name}</a><small>{team.htTeamId}</small></td>
              <td>{getCountryWorldDetails(team.managerCountryId)?.emoji || '🌐'} {team.managerName || 'Unknown'}<small>{team.managerId || 'Missing manager ID — unresolved'}</small></td>
              <td>{getCountryWorldDetails(team.countryId)?.emoji || '🌐'} {getCountryWorldDetails(team.countryId)?.leagueName || team.countryName || 'Unknown'}<small>{team.leagueId ? leagueName(team.leagueId) : 'Competition unknown'} · LeagueID {team.leagueId || 'unknown'}</small>{!team.flagCountryId && <small>Flag country unknown</small>}</td>
              {(['home', 'away'] as const).map(side => <td key={side}>{!flags ? 'Unknown' : <details><summary>{flags[side].length} collected{flags[side === 'home' ? 'homeUnknown' : 'awayUnknown'] ? ' + unknown' : ''}</summary>{flags[side].map(id => `${HATTRICK_WORLD_DETAILS[id]?.emoji || '🌐'} ${leagueName(id)}`).join(', ') || (flags[side === 'home' ? 'homeUnknown' : 'awayUnknown'] ? 'Unresolved flag entries' : 'Confirmed empty collection')}</details>}</td>)}
              <td>{issues[String(team.htTeamId)] && <small>{issues[String(team.htTeamId)]}</small>}{flags ? <><span>{savedIds.includes(team.htTeamId) ? 'Saved — needs refresh' : 'Fetched this session'}</span><small>{flags.fetchedAt}</small></> : 'Not fetched'}
                <Button variant="outline" disabled={busy} onClick={() => void refreshFlags([team.htTeamId])}>Refresh</Button></td>
              <td><input type="checkbox" aria-label={`Exclude ${team.name} from pairings`} checked={excludedIds.includes(team.htTeamId)} disabled={busy}
                onChange={event => {
                  setExcludedIds(ids => event.target.checked ? [...ids, team.htTeamId] : ids.filter(id => id !== team.htTeamId));
                  setDraft(null);
                }} /></td>
            </tr>;
          })}
        </tbody></table></div>
        {!snapshot.teams.length && <p>No admitted participants.</p>}
      </>}
    </SectionCard>
    <SectionCard title="Round one simulator">
      <p>When A hosts B, A can gain B’s country flag in A’s home collection; B can gain A’s country flag in B’s away collection.</p>
      <p>{pairingTeams.length} included · {excludedIds.length} excluded. Changing exclusions clears the draft. Exclusions apply only in this open playground; JSON retains the full roster.</p>
      <div className={styles.actions}>
        <label>Seed <input value={seed} disabled={busy} onChange={event => setSeed(event.target.value)} /></label>
        <Button disabled={busy || !pairingTeams.length} onClick={() => generate(seed)}>Generate baseline</Button>
        <Button variant="outline" disabled={busy || !pairingTeams.length} onClick={() => generate(String(Date.now()))}>Reshuffle</Button>
      </div>
      {draft && snapshot && metrics && <>
        <p>Draft seed: {draft.seed}. Teams gaining a flag: {metrics.gaining} · Matches benefiting both: {metrics.both} · No gain: {metrics.nothing} · Unknown: {metrics.unknown}</p>
        <div className={styles.scroll}><table><caption>Potential flag benefits if these fixtures are played</caption><thead><tr><th>Home</th><th>Home benefit</th><th>Away</th><th>Away benefit</th><th>Venue</th></tr></thead><tbody>
          {draft.pairs.map((pair, index) => { const benefit = pairBenefits(pair, snapshot.teams, snapshot.flags); return <tr key={`${pair.homeId}-${pair.awayId}`}>
            <td>{teamName(pair.homeId)}</td><td>{benefit.home}</td><td>{teamName(pair.awayId)}</td><td>{benefit.away}</td>
            <td><Button variant="outline" disabled={busy} onClick={() => setDraft({ ...draft, pairs: draft.pairs.map((item, i) => i === index ? { homeId: item.awayId, awayId: item.homeId } : item) })}>Swap venue</Button></td>
          </tr>; })}
        </tbody></table></div>
        {draft.byeId !== null && <p>BYE: {teamName(draft.byeId)}</p>}
        {draft.unresolvedIds.length > 0 && <p>Unresolved — same-manager restriction or missing manager identity: {draft.unresolvedIds.map(teamName).join(', ')}</p>}
      </>}
    </SectionCard>
  </div>;
}
