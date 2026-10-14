import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { HATTRICK_WORLD_DETAILS, getCountryWorldDetails } from '../../../shared/worlddetails';
import {
  createFlagDraft, pairBenefits, parseFlagSnapshot, reconcileFlagSnapshot,
  type FlagCollection, type FlagDraft, type FlagHunterTeam, type FlagSnapshot,
} from '../../../shared/flag-hunters';
import { analyzeFlagRoster, createScarcityDraft, reviewFlagDraft, type ScarcityDraft } from '../../../shared/flag-pairing';
import { COUNTRY_ACTIVE_TEAM_COUNTS_CHECKED_AT } from '../../../shared/country-active-team-counts';
import styles from './FlagHunters.module.sass';

const STORAGE_KEY = 'forge-flag-hunters-v1';
const endpoint = (slug: string) => `/api/testing?tool=flag-hunters&slug=${encodeURIComponent(slug)}`;
const leagueName = (id: number) => HATTRICK_WORLD_DETAILS[id]?.leagueName || `League ${id}`;
const displayError = (error: unknown) => error instanceof Error ? error.message : 'Request failed.';
const signature = (teams: FlagHunterTeam[]) => JSON.stringify(teams.map(team => [team.id, team.htTeamId, team.managerId, team.leagueId, team.flagCountryId, team.genderId]).sort());

export function FlagHunters() {
  const [slug, setSlug] = useState('around-the-world');
  const [snapshot, setSnapshot] = useState<FlagSnapshot | null>(null);
  const [title, setTitle] = useState('');
  const [loadedSlug, setLoadedSlug] = useState('around-the-world');
  const [draft, setDraft] = useState<FlagDraft | ScarcityDraft | null>(null);
  const [baseline, setBaseline] = useState<FlagDraft | null>(null);
  const [forcedByeId, setForcedByeId] = useState<number | null>(null);
  const [manualVenues, setManualVenues] = useState(false);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [sort, setSort] = useState<{ column: 'manager' | 'home' | 'away' | 'total'; ascending: boolean } | null>(null);
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
        if (signature(previous.teams) !== signature(teams)) { setDraft(null); setBaseline(null); }
      } else { setDraft(null); setBaseline(null); setExcludedIds([]); }
      setExcludedIds(ids => ids.filter(id => teams.some(team => team.htTeamId === id)));
      setTitle(payload.tournament.name); setLoadedSlug(requestedSlug);
      setSavedIds(Object.values(flags).map(item => item.htTeamId));
      const next: FlagSnapshot = { version: 2, tournamentId: payload.tournament.id, savedAt: new Date().toISOString(), teams, flags };
      commit(next);
      return next;
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
          setDraft(null); setBaseline(null);
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
      setDraft(null); setBaseline(null);
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
  const pairingTeams = useMemo(() => snapshot?.teams.filter(team => !excludedIds.includes(team.htTeamId)) || [], [snapshot, excludedIds]);
  const generate = async (nextSeed: string, mode: 'scarcity' | 'random' = 'scarcity') => {
    if (!snapshot) return;
    // Registrations continue arriving: every generation reloads admission, then reuses saved flag collections.
    const fresh = await loadRoster(loadedSlug);
    if (!fresh) return;
    setBusy(true);
    try {
      const included = fresh.teams.filter(team => !excludedIds.includes(team.htTeamId));
      const override = forcedByeId !== null && included.some(team => team.htTeamId === forcedByeId) && included.length % 2 === 1 ? forcedByeId : null;
      if (override !== forcedByeId) setForcedByeId(override);
      const random = createFlagDraft(included, fresh.flags, nextSeed, override);
      setSeed(nextSeed); setBaseline(random); setManualVenues(false);
      setDraft(mode === 'random' ? random : createScarcityDraft(included, fresh.flags, nextSeed, override)); setError('');
    } catch (failure) { setError(displayError(failure)); }
    finally { setBusy(false); }
  };
  const sortedTeams = [...(snapshot?.teams || [])].sort((a, b) => {
    if (!sort) return 0;
    let comparison: number;
    if (sort.column === 'manager') {
      comparison = (a.managerName || '').localeCompare(b.managerName || '', 'en', { sensitivity: 'base' });
    } else {
      const aFlags = snapshot?.flags[String(a.htTeamId)];
      const bFlags = snapshot?.flags[String(b.htTeamId)];
      if (!aFlags || !bFlags) return aFlags ? -1 : bFlags ? 1 : a.htTeamId - b.htTeamId;
      const count = (flags: FlagCollection) => sort.column === 'total'
        ? flags.home.length + flags.away.length
        : (sort.column === 'home' ? flags.home.length : flags.away.length);
      comparison = count(aFlags) - count(bFlags);
    }
    return (sort.ascending ? comparison : -comparison) || a.htTeamId - b.htTeamId;
  });
  const sortHeader = (column: 'manager' | 'home' | 'away' | 'total', label: string) => (
    <th scope="col" aria-sort={sort?.column === column ? (sort.ascending ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={styles.sortButton} onClick={() => setSort(current => ({
        column, ascending: current?.column === column ? !current.ascending : column === 'manager',
      }))}>
        {label}{sort?.column === column && <span aria-hidden="true">{sort.ascending ? ' ↓' : ' ↑'}</span>}
      </button>
    </th>
  );
  const analysis = useMemo(() => draft && 'analysis' in draft ? draft.analysis : snapshot ? analyzeFlagRoster(pairingTeams, snapshot.flags, seed) : null, [draft, snapshot, pairingTeams, seed]);
  const review = useMemo(() => draft && snapshot && analysis ? reviewFlagDraft(draft, pairingTeams, snapshot.flags, analysis) : null, [draft, snapshot, analysis, pairingTeams]);
  const baselineReview = useMemo(() => baseline && snapshot ? reviewFlagDraft(baseline, pairingTeams, snapshot.flags) : null, [baseline, snapshot, pairingTeams]);
  const countryFlag = (id: number | null) => id === null ? 'Unknown' : `${HATTRICK_WORLD_DETAILS[id]?.emoji || '🌐'} ${leagueName(id)}`;
  const exportDraft = () => {
    if (!draft || !snapshot || !review) return;
    const data = { tournamentId: snapshot.tournamentId, snapshotSavedAt: snapshot.savedAt, bookingAvailability: 'not verified',
      excludedTeamIds: excludedIds, draft, review, randomBaseline: baseline, randomSummary: baselineReview?.summary };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `flag-hunters-round-one-${loadedSlug}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const teamName = (id: number) => snapshot?.teams.find(team => team.htTeamId === id)?.name || String(id);

  return <div className={styles.layout}>
    <SectionCard title="Flag Hunters" subtitle="Participant roster and round-one playground">
      <p>Scarcity-first, manager-safe opponents and missing-flag venue selection. Drafts stay in this playground.</p>
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
        <div className={styles.scroll}><table><caption>Admitted participants and flag collections</caption><thead><tr><th>Team</th>{sortHeader('manager', 'Manager')}<th>Country</th>{sortHeader('home', 'Home flags')}{sortHeader('away', 'Away flags')}{sortHeader('total', 'Total')}<th>Snapshot status</th><th>Exclude</th></tr></thead><tbody>
          {sortedTeams.map(team => {
            const flags = snapshot.flags[String(team.htTeamId)];
            return <tr key={team.htTeamId}>
              <td><a href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.htTeamId}`} target="_blank" rel="noreferrer">{getCountryWorldDetails(team.countryId)?.emoji || '🌐'} {team.name}</a><small>{team.htTeamId}</small></td>
              <td>{getCountryWorldDetails(team.managerCountryId)?.emoji || '🌐'} {team.managerName || 'Unknown'}<small>{team.managerId || 'Missing manager ID — unresolved'}</small></td>
              <td>{getCountryWorldDetails(team.countryId)?.emoji || '🌐'} {getCountryWorldDetails(team.countryId)?.leagueName || team.countryName || 'Unknown'}<small>{team.leagueId ? leagueName(team.leagueId) : 'Competition unknown'} · LeagueID {team.leagueId || 'unknown'}</small>{!team.flagCountryId && <small>Flag country unknown</small>}</td>
              {(['home', 'away'] as const).map(side => <td key={side}>{!flags ? 'Unknown' : <details><summary>{flags[side].length} collected{flags[side === 'home' ? 'homeUnknown' : 'awayUnknown'] ? ' + unknown' : ''}</summary>{flags[side].map(id => `${HATTRICK_WORLD_DETAILS[id]?.emoji || '🌐'} ${leagueName(id)}`).join(', ') || (flags[side === 'home' ? 'homeUnknown' : 'awayUnknown'] ? 'Unresolved flag entries' : 'Confirmed empty collection')}</details>}</td>)}
              <td title={flags && (flags.homeUnknown || flags.awayUnknown) ? 'Known flags only; collection contains unresolved entries.' : undefined}>{flags ? flags.home.length + flags.away.length : 'Unknown'}</td>
              <td>{issues[String(team.htTeamId)] && <small>{issues[String(team.htTeamId)]}</small>}{flags ? <><span>{savedIds.includes(team.htTeamId) ? 'Saved — needs refresh' : 'Fetched this session'}</span><small>{flags.fetchedAt}</small></> : 'Not fetched'}
                <Button variant="outline" disabled={busy} onClick={() => void refreshFlags([team.htTeamId])}>Refresh</Button></td>
              <td><input type="checkbox" aria-label={`Exclude ${team.name} from pairings`} checked={excludedIds.includes(team.htTeamId)} disabled={busy}
                onChange={event => {
                  setExcludedIds(ids => event.target.checked ? [...ids, team.htTeamId] : ids.filter(id => id !== team.htTeamId));
                  setDraft(null); setBaseline(null);
                }} /></td>
            </tr>;
          })}
        </tbody></table></div>
        {!snapshot.teams.length && <p>No admitted participants.</p>}
      </>}
    </SectionCard>
    <SectionCard title="Round one pairing draft">
      <p>When A hosts B, A can gain B’s country flag at home; B can gain A’s country flag away.</p>
      <p>Collection-only feasibility. Booking availability, friendly dates, cup status and challenge permission have not been verified. No fixtures or challenges are created.</p>
      <p>{pairingTeams.length} included · {excludedIds.length} excluded. Every generation reloads the admitted roster. Exclusions apply only in this playground.</p>
      <div className={styles.actions}>
        <label>Seed <input value={seed} disabled={busy} onChange={event => setSeed(event.target.value)} /></label>
        <label>BYE override <select value={forcedByeId ?? ''} disabled={busy || pairingTeams.length % 2 === 0} onChange={event => { setForcedByeId(event.target.value ? Number(event.target.value) : null); setDraft(null); setBaseline(null); }}>
          <option value="">Choose automatically</option>{pairingTeams.map(team => <option key={team.htTeamId} value={team.htTeamId}>{team.name}</option>)}
        </select></label>
        <Button disabled={busy || !pairingTeams.length} onClick={() => void generate(seed)}>Generate scarcity draft</Button>
        <Button variant="outline" disabled={busy || !pairingTeams.length} onClick={() => void generate(seed, 'random')}>Random comparison</Button>
        <Button variant="outline" disabled={busy || !pairingTeams.length} onClick={() => void generate(String(Date.now()))}>New seed</Button>
        <Button variant="outline" disabled={busy || !draft} onClick={exportDraft}>Export draft JSON</Button>
      </div>
      <p>Priority: fewest useful opponents (above zero), then manager’s maximum collection total, rarer team country, then seed. Completed and unknown collections receive no scarcity priority. Population snapshot: {COUNTRY_ACTIVE_TEAM_COUNTS_CHECKED_AT}.</p>
      {analysis && analysis.shortages.length > 0 && <details><summary>{analysis.shortages.length} shared opportunity shortage{analysis.shortages.length === 1 ? '' : 's'}</summary>
        {analysis.shortages.map((group, index) => <p key={index}>{group.teamIds.map(teamName).join(', ')} share only {group.opponentIds.length} useful opponent{group.opponentIds.length === 1 ? '' : 's'}: {group.opponentIds.map(teamName).join(', ')}. At least {group.minimumMisses} collecting team{group.minimumMisses === 1 ? '' : 's'} must miss.</p>)}
      </details>}
      {draft && review && snapshot && <>
        <p>{'algorithm' in draft ? 'Scarcity heuristic' : 'Random baseline'} · Seed {draft.seed}{manualVenues ? ' · Organizer changed venues' : ''}. Matches {review.summary.matches} · BYEs {review.summary.byes} · Unresolved {review.summary.unresolved}.</p>
        <p>Teams gaining flags {review.summary.gainingTeams} · Managers gaining flags {review.summary.gainingManagers} · Mutual matches {review.summary.mutualMatches} · Complete collections {review.summary.complete} · Unknown data {review.summary.unknown} · No useful opponent {review.summary.unavailable} · Missed collectors {review.summary.missedCollectors}.</p>
        {'algorithm' in draft && <p>Protects earlier collecting gains, then prefers new manager coverage, more team gains and rarer missing flags. Reassigns up to three matches at once; not a proven global optimum.{draft.searchLimited ? ' The bounded search limit was reached.' : ''}</p>}
        {baselineReview && <p>Same-roster random comparison: {baselineReview.summary.gainingTeams} teams and {baselineReview.summary.gainingManagers} managers gain; {baselineReview.summary.mutualMatches} mutual matches; {baselineReview.summary.missedCollectors} missed collectors.</p>}
        <div className={styles.scroll}><table><caption>Initial collecting priority and current draft review</caption><thead><tr><th>Priority</th><th>Team / country</th><th>Manager</th><th>Home / away</th><th>Useful opponents</th><th>Opponent / venue</th><th>Flag / result</th><th>Reason</th></tr></thead><tbody>
          {review.rows.map(row => <tr key={row.teamId}>
            <td>{row.priority ?? '—'}<small>{row.status}</small></td>
            <td>{getCountryWorldDetails(row.team.countryId)?.emoji || '🌐'} {row.team.name}<small>{countryFlag(row.team.flagCountryId)}</small></td>
            <td>{getCountryWorldDetails(row.team.managerCountryId)?.emoji || '🌐'} {row.team.managerName || 'Unknown'}<small>Manager maximum: {row.managerTotal}</small></td>
            <td>{row.homeCount ?? '?'} / {row.awayCount ?? '?'}</td><td>{row.usefulOpponentIds.length}</td>
            <td>{row.opponent?.name || '—'}<small>{row.venue || '—'}</small></td>
            <td>{row.gainCountryId !== null ? countryFlag(row.gainCountryId) : row.result}</td>
            <td>{row.reason}<small>{row.explanation}</small></td>
          </tr>)}
        </tbody></table></div>
        <div className={styles.scroll}><table><caption>Proposed matches — venues may be changed for review</caption><thead><tr><th>Home</th><th>Home flag</th><th>Away</th><th>Away flag</th><th>Venue</th></tr></thead><tbody>
          {draft.pairs.map((pair, index) => { const benefit = pairBenefits(pair, snapshot.teams, snapshot.flags); return <tr key={`${pair.homeId}-${pair.awayId}`}>
            <td>{teamName(pair.homeId)}</td><td>{benefit.home === 'gain' ? countryFlag(snapshot.teams.find(team => team.htTeamId === pair.awayId)!.flagCountryId) : benefit.home}</td>
            <td>{teamName(pair.awayId)}</td><td>{benefit.away === 'gain' ? countryFlag(snapshot.teams.find(team => team.htTeamId === pair.homeId)!.flagCountryId) : benefit.away}</td>
            <td><Button variant="outline" disabled={busy} onClick={() => { setManualVenues(true); setDraft({ ...draft, pairs: draft.pairs.map((item, i) => i === index ? { homeId: item.awayId, awayId: item.homeId } : item) }); }}>Swap venue</Button></td>
          </tr>; })}
        </tbody></table></div>
        {draft.byeId !== null && <p>BYE: {teamName(draft.byeId)}. {'byeReason' in draft ? draft.byeReason : 'Seeded random baseline BYE; use the override to choose another team.'}</p>}
        {draft.unresolvedIds.length > 0 && <p>Unresolved eligible matching constraints or missing manager identity: {draft.unresolvedIds.map(teamName).join(', ')}</p>}
        <div className={styles.scroll}><table><caption>Manager coverage this round</caption><thead><tr><th>Manager</th><th>Participating teams</th><th>Team gains</th></tr></thead><tbody>
          {review.managers.map(manager => <tr key={manager.managerId ?? 'unknown'}><td>{manager.managerName}</td><td>{manager.teams.length}<small>{manager.teams.join(', ')}</small></td><td>{manager.gains}</td></tr>)}
        </tbody></table></div>
      </>}
      {!draft && analysis && <div className={styles.scroll}><table><caption>Initial collecting priority before generation</caption><thead><tr><th>Priority</th><th>Team</th><th>Useful opponents</th><th>Status / reason</th></tr></thead><tbody>
        {analysis.priorities.map(row => <tr key={row.teamId}><td>{row.priority ?? '—'}</td><td>{teamName(row.teamId)}</td><td>{row.usefulOpponentIds.length}</td><td>{row.status}<small>{row.reason}</small></td></tr>)}
      </tbody></table></div>}
    </SectionCard>
  </div>;
}
