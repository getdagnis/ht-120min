import { useEffect, useRef, useState } from 'react';
import { useClientNow } from '../../../hooks/useHydratedBrowserState';
import { Button } from '../../Button/Button';
import { validateOrganizerPairings, serializeOrganizerPairings, type OrganizerRoundTeam, type OrganizerRoundSelection,
  type OrganizerRoundHistory, type RoundParticipation } from '../../../utils/organizer-round';
import { formatCalendarDate, type CalendarSlot } from '../../../utils/hattrick-calendar';
import type { LengthSchedulePairing } from '../../../utils/length-schedule';
import { isProtectedPlanningMatch, proposeOrganizerPairs } from '../../../utils/organizer-pairing-assistant';
import { exportPairingCsv, importPairingCsv, pairKey, pairIsBooked, pairingBenefits, latestCompletedFriendlyWindowEnd,
  validateFinalObservations, type SlotObservation, type PlanningRound } from '../../../../shared/organizer-planning';
import { canFlagTeamsPair } from '../../../../shared/flag-matching';
import { analyzeFlagRoster } from '../../../../shared/flag-pairing';
import { flagRoster } from '../../../../shared/organizer-planning';
import type { FlagCollection } from '../../../../shared/flag-hunters';
import { interest120m, type PairingPreference } from '../../../../shared/pairing-preferences';
import { getRoundDisplayLabel, type DisplayRound } from '../../../../shared/round-display';
import styles from './OrganizerRoundPanel.module.sass';

type Slot = Omit<CalendarSlot, 'nominalDate'> & { nominalDate: string };
interface Context {
  teams: OrganizerRoundTeam[]; slots: Slot[]; history: OrganizerRoundHistory[]; rosterVersion: string;
  flags: Record<string, FlagCollection>; preferences: Record<string, PairingPreference>; existingRounds: PlanningRound[]; storageKey: string; batchSize: number; canRepairSavedRounds: boolean;
  observations: Array<{ slot_id: string; team_id: string; observation: SlotObservation }>;
  rounds: DisplayRound[];
}
interface Draft {
  slotId: string; roundId: string; selection: OrganizerRoundSelection[];
  pairs: LengthSchedulePairing[] | null; baseline: LengthSchedulePairing[];
}
interface Proposal {
  tournamentId: string; slotId: string; roundId: string | null; rosterVersion: string;
  roster: OrganizerRoundSelection[]; pairings: LengthSchedulePairing[];
}
interface FinalRun { token: string; proposal: Proposal; done: string[] }
interface ScanRun { action: 'check' | 'flags'; ids: string[]; done: string[] }
const asPairs = (round: PlanningRound): LengthSchedulePairing[] => round.matches.map(match => ({
  homeTeamId: match.home_team_id, awayTeamId: match.away_team_id, isBye: !match.home_team_id || !match.away_team_id,
}));
const teamGroup = (team: OrganizerRoundTeam) => team.active ? 'active' : team.reserve_active ? 'lobby' : 'past';

async function request<T>(body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/app?route=organizer-round', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Round operation failed.');
  return result as T;
}

export function OrganizerRoundPanel({ tournamentId, onChanged, canOverride }: {
  tournamentId: string; onChanged: () => Promise<void>; canOverride: boolean;
}) {
  const now = useClientNow(30_000);
  const [context, setContext] = useState<Context | null>(null);
  const [selection, setSelection] = useState<OrganizerRoundSelection[]>([]);
  const [slotId, setSlotId] = useState(''), [roundId, setRoundId] = useState('');
  const [query, setQuery] = useState(''), [group, setGroup] = useState('all');
  const [pairs, setPairs] = useState<LengthSchedulePairing[] | null>(null);
  const [baseline, setBaseline] = useState<LengthSchedulePairing[]>([]);
  const [checks, setChecks] = useState<Record<string, SlotObservation>>({});
  const [flags, setFlags] = useState<Record<string, FlagCollection>>({});
  const [busy, setBusy] = useState(false), [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null), [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [savedDraft, setSavedDraft] = useState<Draft | null>(null);
  const [finalRun, setFinalRun] = useState<FinalRun | null>(null);
  const [scanRun, setScanRun] = useState<ScanRun | null>(null);
  const [showOpportunities, setShowOpportunities] = useState(false);
  const [attemptedIds, setAttemptedIds] = useState<string[]>([]);
  const stop = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { stop.current = true; controller.current?.abort(); }, []);

  const available = context?.teams.filter(team => !team.is_placeholder) || [];
  const selected = available.filter(team => selection.some(row => row.teamId === team.id));
  const shown = available.filter(team => (group === 'all' || teamGroup(team) === group) && team.name.toLowerCase().includes(query.toLowerCase()));
  const target = context?.existingRounds.find(round => round.id === roundId);
  const slot: Slot | undefined = target ? {
    id: target.reserved_slot_id, kind: target.reserved_slot_kind as CalendarSlot['kind'], nominalDate: target.reserved_slot_date,
    htSeason: 0, htWeek: 0, ht120minSeason: 0, selectable: true, blockedReason: null, warning: null,
  } : context?.slots.find(value => value.id === slotId);
  const calendarSlot = slot ? { ...slot, nominalDate: new Date(slot.nominalDate) } : null;
  const flagFreshnessBoundary = calendarSlot ? latestCompletedFriendlyWindowEnd(calendarSlot, now) : Infinity;
  const protectedPairs = target?.matches.filter(match => isProtectedPlanningMatch(match, now)).map(match => ({
    homeTeamId: match.home_team_id, awayTeamId: match.away_team_id, isBye: !match.home_team_id || !match.away_team_id,
  })) || [];
  const locked = (pair: LengthSchedulePairing) => protectedPairs.some(row => pairKey(row) === pairKey(pair)) || pairIsBooked(pair, selected, checks);
  const playingIds = new Set((pairs || []).flatMap(pair => [pair.homeTeamId, pair.awayTeamId]));
  const playingRoster = selection.filter(row => playingIds.has(row.teamId));
  const validation = pairs ? validateOrganizerPairings(playingRoster, pairs, selected) : null;
  const previewIssue = pairs ? validateFinalObservations(pairs, selected, checks, protectedPairs, Boolean(roundId), target ? asPairs(target) : []) : null;
  const roster = flagRoster(selected);
  const incompatible = pairs?.some(pair => pair.homeTeamId && pair.awayTeamId && !locked(pair) && !canFlagTeamsPair(
    roster.find(team => team.id === pair.homeTeamId)!, roster.find(team => team.id === pair.awayTeamId)!,
  ));
  const effectiveFlags = Object.fromEntries(Object.entries(flags).map(([key, value]) => [key,
    calendarSlot && !checks[selected.find(team => team.ht_team_id === value.htTeamId)?.id || '']?.flagsOngoing &&
      Date.parse(value.fetchedAt) >= flagFreshnessBoundary
      ? value : { ...value, homeUnknown: true, awayUnknown: true }]));
  const kickoffResults = (pairs || []).map(pair => {
    if (locked(pair) && target) {
      return {
        scheduledFor: target.matches.find(match => match.home_team_id === pair.homeTeamId && match.away_team_id === pair.awayTeamId)?.scheduled_for,
        error: null,
      };
    }
    try {
      return { scheduledFor: calendarSlot ? serializeOrganizerPairings(calendarSlot, [pair], selected)[0].scheduled_for : null, error: null };
    } catch (cause) {
      return { scheduledFor: null, error: cause instanceof Error ? cause.message : 'Kickoff is unknown.' };
    }
  });
  const kickoffs = kickoffResults.map(result => result.scheduledFor);
  const kickoffError = kickoffResults.find(result => result.error !== null)?.error ?? null;
  const pastKickoff = (pairs || []).some((pair, i) => !locked(pair) && kickoffs[i] && Date.parse(kickoffs[i]!) <= now);
  const gains = new Set<number>(), gainingTeams = new Set<string>();
  for (const pair of pairs || []) {
    const benefit = pairingBenefits(pair, selected, effectiveFlags);
    for (const [id, side] of [[pair.homeTeamId, 'home'], [pair.awayTeamId, 'away']] as const) if (benefit?.[side] === 'gain') {
      if (id) gainingTeams.add(id);
      const manager = selected.find(team => team.id === id)?.hattrick_user_id;
      if (manager) gains.add(manager);
    }
  }
  const changedTeams = new Set((pairs || []).filter(pair => !baseline.some(row => pairKey(row) === pairKey(pair)))
    .flatMap(pair => [pair.homeTeamId, pair.awayTeamId].filter((id): id is string => Boolean(id))));

  useEffect(() => {
    if (!context || !touched) return;
    try { localStorage.setItem(context.storageKey, JSON.stringify({ slotId, roundId, selection, pairs, baseline })); }
    catch {
      // Keep the storage failure visible so the organizer can export a backup.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Browser could not save the working draft. Export CSV before leaving.');
    }
  }, [context, touched, slotId, roundId, selection, pairs, baseline]);

  function edited() { setTouched(true); setFinalRun(null); setScanRun(null); setSuccess(null); }
  function previousChecks(data: Context, id: string) {
    return Object.fromEntries(data.observations.filter(row => row.slot_id === id).map(row => [row.team_id,
      { ...row.observation, state: 'unknown' as const, reason: `Previous check ${row.observation.checkedAt}: ${row.observation.reason} Recheck required.` }]));
  }
  async function load() {
    setBusy(true); setError(null); setFinalRun(null); setScanRun(null);
    try {
      const response = await fetch(`/api/app?route=organizer-round&tournamentId=${encodeURIComponent(tournamentId)}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json() as Context & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not load round options.');
      setContext(data); setFlags(data.flags); setTouched(false); setSelection([]); setPairs(null); setBaseline([]); setRoundId('');
      setAttemptedIds([]);
      setSlotId(data.slots[0]?.id || ''); setChecks(previousChecks(data, data.slots[0]?.id || '')); setSavedDraft(null);
      try {
        const raw = localStorage.getItem(data.storageKey);
        if (raw && raw.length <= 150_000) {
          const draft = JSON.parse(raw) as Draft;
          if (typeof draft.slotId === 'string' && typeof draft.roundId === 'string' && Array.isArray(draft.selection) &&
              (draft.pairs === null || Array.isArray(draft.pairs)) && Array.isArray(draft.baseline)) setSavedDraft(draft);
        }
      } catch { setError('Saved browser draft could not be read. You can import a CSV instead.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load round options.'); }
    finally { setBusy(false); }
  }
  function selectRound(id: string) {
    if (!context) return;
    edited(); setRoundId(id); setPairs(null); setBaseline([]); setSelection([]);
    setAttemptedIds([]);
    const round = context.existingRounds.find(row => row.id === id);
    const nextSlot = round?.reserved_slot_id || context.slots[0]?.id || '';
    setSlotId(nextSlot); setChecks(previousChecks(context, nextSlot));
    if (round) { setSelection(round.round_participants.map(row => ({ teamId: row.team_id, participation: row.participation }))); setPairs(asPairs(round)); setBaseline(asPairs(round)); }
  }
  function restore() {
    if (!savedDraft || !context) return;
    const savedRound = context.existingRounds.find(round => round.id === savedDraft.roundId);
    if ((savedDraft.roundId && (!savedRound || !context.canRepairSavedRounds)) || (!savedDraft.roundId && !context.slots.some(row => row.id === savedDraft.slotId))) {
      setError('The saved slot or round is no longer available.'); return;
    }
    const safeSelection = savedDraft.selection.filter(row => row && available.some(team => team.id === row.teamId) && ['round_only', 'admit'].includes(row.participation));
    const safePairs = savedDraft.pairs?.filter(pair => pair && [pair.homeTeamId, pair.awayTeamId].every(id => id === null || safeSelection.some(row => row.teamId === id))) || null;
    edited(); setRoundId(savedDraft.roundId); setSlotId(savedDraft.slotId); setSelection(safeSelection); setPairs(safePairs);
    setBaseline(savedRound ? asPairs(savedRound) : safePairs || []); setChecks(previousChecks(context, savedDraft.slotId)); setSavedDraft(null);
    setAttemptedIds([]);
    setSuccess('Draft restored. Recheck availability before generating or saving.');
  }
  function choose(team: OrganizerRoundTeam, checked: boolean) {
    edited(); setSelection(rows => checked ? [...rows.filter(row => row.teamId !== team.id), { teamId: team.id, participation: 'round_only' }]
      : rows.filter(row => row.teamId !== team.id)); setPairs(null);
  }
  function chooseShown(checked: boolean) {
    edited(); setSelection(rows => checked ? [...rows, ...shown.filter(team => !rows.some(row => row.teamId === team.id)).map(team => ({ teamId: team.id, participation: 'round_only' as const }))]
      : rows.filter(row => !shown.some(team => team.id === row.teamId))); setPairs(null);
  }
  function updatePair(index: number, change: Partial<LengthSchedulePairing>) {
    edited(); setPairs(rows => rows?.map((row, i) => i === index ? { ...row, ...change } : row) || null);
  }
  function startWork() { stop.current = false; controller.current = new AbortController(); setBusy(true); setError(null); setSuccess(null); }
  async function scan(action: 'check' | 'flags', resume = false, proposedOnly = false) {
    if (!context || !slot) return;
    const previousRun = resume && scanRun?.action === action ? scanRun : null;
    edited(); startWork();
    const candidates = proposedOnly ? selected.filter(team => playingIds.has(team.id)) : selected;
    const teams = action === 'flags' ? candidates.filter(team => !flags[String(team.ht_team_id)] ||
      flags[String(team.ht_team_id)].homeUnknown || flags[String(team.ht_team_id)].awayUnknown ||
      Date.parse(flags[String(team.ht_team_id)].fetchedAt) < flagFreshnessBoundary) : candidates;
    let run: ScanRun = previousRun || { action, ids: teams.map(team => team.id), done: [] };
    setScanRun(run);
    const pending = run.ids.filter(id => !run.done.includes(id));
    let failures = 0;
    try {
      for (let index = 0; index < pending.length && !stop.current; index += context.batchSize) {
        const batch = pending.slice(index, index + context.batchSize);
        setProgress(`${action === 'check' ? 'Availability' : 'Flag refresh'}: ${run.done.length}/${run.ids.length}`);
        let successful: string[] = [];
        if (action === 'check') {
          setAttemptedIds(ids => [...new Set([...ids, ...batch])]);
          setChecks(rows => ({ ...rows, ...Object.fromEntries(batch.map(id => [id, { teamId: id, state: 'unknown', checkedAt: rows[id]?.checkedAt || '',
            reason: 'Recheck in progress or incomplete.', pendingOpponentIds: [], challengesKnown: false } as SlotObservation])) }));
          const result = await request<{ results: SlotObservation[] }>({ action, tournamentId, slotId, roundId: roundId || null, teamIds: batch }, controller.current!.signal);
          failures += result.results.filter(row => row.state === 'unknown' || (row.state === 'free' && !row.challengesKnown)).length;
          successful = result.results.filter(row => row.state !== 'unknown' && (row.state !== 'free' || row.challengesKnown)).map(row => row.teamId);
          setChecks(rows => ({ ...rows, ...Object.fromEntries(result.results.map(row => [row.teamId, row])) }));
        } else {
          const result = await request<{ results: Array<{ teamId: string; flags?: FlagCollection; error?: string }> }>({ action, tournamentId, slotId, roundId: roundId || null, teamIds: batch }, controller.current!.signal);
          for (const row of result.results) {
            if (row.flags) { successful.push(row.teamId); setFlags(values => ({ ...values, [String(row.flags!.htTeamId)]: row.flags! })); }
            else { failures++; setError(`${available.find(team => team.id === row.teamId)?.name}: ${row.error}`); }
          }
        }
        run = { ...run, done: [...new Set([...run.done, ...successful])] }; setScanRun(run);
      }
      setProgress(`${stop.current ? 'Stopped' : 'Finished'}: ${run.done.length}/${run.ids.length}; ${failures} failed.`);
      if (run.done.length === run.ids.length) setScanRun(null);
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : 'Batch failed.'} Scan stopped at ${run.done.length}/${run.ids.length}. Use Resume / retry to continue.`);
    }
    finally { setBusy(false); }
  }
  function generate(repair: boolean, balanced = false) {
    if (!context) return;
    edited();
    if (selected.some(team => !attemptedIds.includes(team.id) && !protectedPairs.some(pair => pair.homeTeamId === team.id || pair.awayTeamId === team.id))) {
      setError('Check availability before generating.'); return;
    }
    try {
      const result = proposeOrganizerPairs({ teams: selected, flags: effectiveFlags, checks, previous: pairs || [], protectedPairs,
        history: context.history, seed: `${tournamentId}:${slotId}`, repair, balanced, preferences: context.preferences });
      setBaseline(pairs || []); setPairs(result.pairs);
      setError(null);
      setSuccess(`${result.pairs.length} fixtures proposed. ${result.unresolved.length} unresolved teams.${result.balancedFallback ? ' Balanced pairing contained incompatible opponents; showing the compatible flag proposal instead.' : ''}${result.searchLimited ? ' Bounded search limit reached; review and edit as needed.' : ''}${result.byeReason ? ` ${result.byeReason}` : ''}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not generate a compatible proposal.'); }
  }
  async function save(resume = false) {
    if (!context || !pairs || validation || kickoffError || pastKickoff || incompatible) return;
    if (!resume && !window.confirm(`${roundId ? 'Verify and apply this repair' : 'Verify and save this counted round'} with ${playingRoster.length} participants?\n${selected.length - playingRoster.length} selected teams have no fixture and will be excluded.\n${canOverride ? 'Existing organizer admission overrides apply.' : ''}`)) return;
    startWork();
    try {
      const proposal: Proposal = { tournamentId, slotId, roundId: roundId || null, rosterVersion: context.rosterVersion, roster: playingRoster, pairings: pairs };
      let run = resume ? finalRun : null;
      if (!run) {
        let result: { verification: string };
        try { result = await request<{ verification: string }>({ ...proposal, action: 'begin-verification' }, controller.current!.signal); }
        catch (cause) { throw new Error(`${cause instanceof Error ? cause.message : 'Verification could not start.'} Nothing was saved. Try Verify and save again.`, { cause }); }
        run = { token: result.verification, proposal, done: [] }; setFinalRun(run);
      }
      const pending = run.proposal.roster.filter(row => !run!.done.includes(row.teamId));
      let observations = { ...checks };
      for (let index = 0; index < pending.length && !stop.current; index += context.batchSize) {
        setProgress(`Final verification: ${run.done.length}/${run.proposal.roster.length}`);
        const batch = pending.slice(index, index + context.batchSize).map(row => row.teamId);
        setAttemptedIds(ids => [...new Set([...ids, ...batch])]);
        setChecks(rows => ({ ...rows, ...Object.fromEntries(batch.map(id => [id, { teamId: id, state: 'unknown', checkedAt: rows[id]?.checkedAt || '',
          reason: 'Final verification in progress or incomplete.', pendingOpponentIds: [], challengesKnown: false } as SlotObservation])) }));
        let result: { results: SlotObservation[] };
        try {
          result = await request<{ results: SlotObservation[] }>({ ...run.proposal, action: 'check', verification: run.token,
            teamIds: batch }, controller.current!.signal);
        } catch (cause) {
          throw new Error(`${cause instanceof Error ? cause.message : 'Availability check failed.'} Final verification stopped at ${run.done.length}/${run.proposal.roster.length}. Nothing was saved. Use Retry / resume final verification.`, { cause });
        }
        observations = { ...observations, ...Object.fromEntries(result.results.map(row => [row.teamId, row])) };
        setChecks(observations);
        const successful = result.results.filter(row => (row.state !== 'unknown' && (row.state !== 'free' || row.challengesKnown)) || protectedPairs.some(pair => pair.homeTeamId === row.teamId || pair.awayTeamId === row.teamId));
        run = { ...run, done: [...new Set([...run.done, ...successful.map(row => row.teamId)])] }; setFinalRun(run);
      }
      setProgress(`Final verification: ${run.done.length}/${run.proposal.roster.length}${stop.current ? ' — stopped' : ''}`);
      if (stop.current) throw new Error('Final verification was stopped. Nothing was saved. Use Retry / resume final verification.');
      if (run.done.length !== run.proposal.roster.length) {
        const unresolved = run.proposal.roster.filter(row => !run.done.includes(row.teamId)).map(row => {
          const name = selected.find(team => team.id === row.teamId)?.name || row.teamId;
          return `${name}: ${observations[row.teamId]?.reason || 'No completed check'}`;
        });
        throw new Error(`Final verification is incomplete for ${unresolved.join('; ')}. Nothing was saved. Use Retry / resume final verification.`);
      }
      const issue = validateFinalObservations(run.proposal.pairings, selected, observations, protectedPairs, Boolean(roundId), target ? asPairs(target) : []);
      if (issue) {
        const unchanged = target ? asPairs(target) : [];
        const affected = run.proposal.pairings.flatMap(pair => {
          const pairIssue = validateFinalObservations([pair], selected, observations, protectedPairs, Boolean(roundId), unchanged);
          if (!pairIssue) return [];
          const names = [pair.homeTeamId, pair.awayTeamId].filter((id): id is string => Boolean(id))
            .map(id => selected.find(team => team.id === id)?.name || id);
          return [`${names.join(' vs ')}: ${pairIssue}`];
        });
        setFinalRun(null);
        throw new Error(`${issue} Affected: ${affected.slice(0, 5).join('; ')}${affected.length > 5 ? `; and ${affected.length - 5} more` : ''}. Nothing was saved.`);
      }
      let result: { roundNumber: number };
      setProgress(`Final verification: ${run.done.length}/${run.proposal.roster.length} checked. Saving the round…`);
      try {
        result = await request<{ roundNumber: number }>({ ...run.proposal, action: 'save', verification: run.token }, controller.current!.signal);
      } catch (cause) {
        setFinalRun(null);
        throw new Error(`${cause instanceof Error ? cause.message : 'Save response unavailable.'} Reload roster and fixtures before trying again; the save was not confirmed.`, { cause });
      }
      try { localStorage.removeItem(context.storageKey); } catch { /* The next restore still requires validation. */ }
      setTouched(false); setFinalRun(null); setContext(null); setPairs(null); setSelection([]); setSavedDraft(null);
      const label = getRoundDisplayLabel({ round_number: result.roundNumber, round_source: 'organizer',
        reserved_slot_kind: slot.kind, reserved_slot_date: slot.nominalDate }, context.rounds);
      setProgress(`${label} saved.`);
      setSuccess(`${label} ${roundId ? 'repaired' : 'saved'}. Fixtures are available in Fixtures & Results.`);
      try { await onChanged(); } catch { setError('The round was saved, but the fixture view could not refresh. Reload the page.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save. Nothing was silently retried.'); }
    finally { setBusy(false); }
  }
  function download() {
    if (!pairs) return;
    const url = URL.createObjectURL(new Blob([exportPairingCsv(pairs, selected, {
      flags: effectiveFlags, checks, kickoffs,
    })], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pairings-${slotId}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <section className={styles.panel} aria-label="Add regular round">
    <h3>Add regular round</h3>
    <p>Select participants, check the friendly slot, then review pairings. Results count in this season.</p>
    <Button type="button" variant="secondaryAction" disabled={busy} onClick={() => void load()}>{context ? 'Reload roster and slots' : 'Choose teams and slot'}</Button>
    {busy && <Button type="button" variant="secondaryAction" onClick={() => { stop.current = true; }}>Stop after this batch</Button>}
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}
    {context && <fieldset disabled={busy} className={styles.form}>
      {savedDraft && <Button type="button" variant="secondaryAction" onClick={restore}>Restore saved draft</Button>}
      {context.canRepairSavedRounds && <label>Round<select value={roundId} onChange={event => selectRound(event.target.value)}>
        <option value="">New additional round</option>
        {context.existingRounds.filter(round => round.phase_status === 'materialized').map(round => <option key={round.id} value={round.id}>Repair {getRoundDisplayLabel(round, context.rounds)}</option>)}
      </select></label>}
      {!roundId && <label>Calendar slot<select aria-label="Calendar slot" value={slotId} onChange={event => {
        edited(); setSlotId(event.target.value); setPairs(null); setAttemptedIds([]); setChecks(previousChecks(context, event.target.value));
      }}>{context.slots.map(value => <option key={value.id} value={value.id}>{formatCalendarDate(new Date(value.nominalDate))} — {value.kind === 'weekend_friendly' ? 'Weekend' : 'Midweek'} (W{value.htWeek})</option>)}</select></label>}
      {!slot && <p>No unused friendly slots remain before this season’s playoffs.</p>}
      {slot?.warning && <p>{slot.warning}</p>}
      <p>Checks show availability at the displayed time. Hattrick bookings can change afterward; recheck and repair when needed.</p>
      <div className={styles.controls}>
        <label>Search teams <input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>Group<select value={group} onChange={event => setGroup(event.target.value)}><option value="all">All teams</option><option value="active">Active</option><option value="lobby">Lobby</option><option value="past">Past</option></select></label>
        {!roundId && <><Button type="button" variant="secondaryAction" size="sm" onClick={() => chooseShown(true)}>Select shown</Button><Button type="button" variant="secondaryAction" size="sm" onClick={() => chooseShown(false)}>Clear shown</Button></>}
      </div>
      <p>{selection.length} teams selected{pairs ? `; ${playingRoster.length} in proposed fixtures; ${selected.length - playingRoster.length} excluded or unresolved` : ''}</p>
      <p>{selected.filter(team => checks[team.id]?.state === 'free').length} free ({selected.filter(team => checks[team.id]?.state === 'free' && checks[team.id]?.offersDirectionKnown && checks[team.id]?.pendingOpponentIds.length).length} with outgoing challenges) · {selected.filter(team => checks[team.id]?.state === 'booked').length} booked · {selected.filter(team => checks[team.id]?.state === 'blocked').length} blocked · {selected.filter(team => !checks[team.id] || checks[team.id].state === 'unknown').length} unknown / unchecked</p>
      {pairs && <p>{pairs.filter(locked).length} protected fixtures</p>}
      <div className={styles.roster}>{shown.map(team => {
        const entry = selection.find(row => row.teamId === team.id), check = checks[team.id], flag = flags[String(team.ht_team_id)];
        const preference = context.preferences?.[String(team.ht_team_id)];
        return <div key={team.id} className={styles.team}>
          <label><input type="checkbox" checked={Boolean(entry)} disabled={Boolean(roundId)} onChange={event => choose(team, event.target.checked)} />{team.name} <small>({teamGroup(team)})</small></label>
          {entry && !team.active && !roundId && <select aria-label={`Participation for ${team.name}`} value={entry.participation} onChange={event => {
            edited(); setSelection(rows => rows.map(row => row.teamId === team.id ? { ...row, participation: event.target.value as RoundParticipation } : row));
          }}><option value="round_only">This round only</option><option value="admit">Admit for subsequent rounds</option></select>}
          {entry && <small>{check ? `${check.state}: ${check.reason} (${check.checkedAt})` : 'Availability not checked'}{check?.pendingOpponentIds.length ? ` ${check.offersDirectionKnown ? 'Outgoing challenges' : 'Pending offers, direction unchecked'}: ${check.pendingOpponentIds.join(', ')}.` : ''}{check?.incomingOfferOpponentIds?.length ? ` Incoming offers: ${check.incomingOfferOpponentIds.join(', ')}.` : ''}<br />
            Flags: {flag ? `${effectiveFlags[String(team.ht_team_id)]?.homeUnknown || effectiveFlags[String(team.ht_team_id)]?.awayUnknown ? 'unknown/stale or partially unknown' : 'current'} (${flag.fetchedAt})` : 'unknown'}{pairs && !playingIds.has(team.id) ? ' · Not included in proposed round' : ''}</small>}
          {entry && preference && <small>Preference: {preference.priority || 'team answer missing; manager fallback'}{interest120m(preference) ? ` · 120m interest ${interest120m(preference)}/4` : ''}{preference.comment ? ` · Survey comment (${preference.commentedAt?.slice(0, 10) || 'date unknown'}): ${preference.comment}` : ''}</small>}
        </div>;
      })}</div>
      <div className={styles.controls}>
        <Button type="button" variant="secondaryAction" disabled={!slot || !selected.length} onClick={() => void scan('check')}>Check / recheck availability</Button>
        {pairs && <Button type="button" variant="secondaryAction" disabled={!slot || !playingRoster.length} onClick={() => void scan('check', false, true)}>Recheck proposed teams</Button>}
        <Button type="button" variant="secondaryAction" disabled={!slot || !selected.length} onClick={() => void scan('flags')}>Refresh missing / stale flags</Button>
        <Button type="button" disabled={!slot || selection.length < 2 || Boolean(roundId)} onClick={() => generate(false)}>Preview flag pairings</Button>
        <Button type="button" variant="secondaryAction" disabled={!slot || selection.length < 2 || Boolean(roundId)} onClick={() => generate(false, true)}>Balanced preview</Button>
        <Button type="button" variant="secondaryAction" disabled={!pairs} onClick={() => generate(true)}>Preview minimal-change repair</Button>
      </div>
      {scanRun && <Button type="button" variant="secondaryAction" onClick={() => void scan(scanRun.action, true)}>Resume / retry {scanRun.action === 'check' ? 'availability' : 'flag refresh'}</Button>}
      <div className={styles.controls}>
        <Button type="button" variant="secondaryAction" disabled={!pairs} onClick={download}>Export pairs CSV</Button>
        <label>Import pairs CSV<input type="file" accept=".csv,text/csv" onChange={async event => {
          const file = event.target.files?.[0]; if (!file) return;
          try {
            if (file.size > 1_000_000) throw new Error('CSV is too large.');
            const imported = importPairingCsv(await file.text(), selected);
            const ids = new Set(imported.flatMap(pair => [pair.homeTeamId, pair.awayTeamId]));
            const issue = validateOrganizerPairings(selection.filter(row => ids.has(row.teamId)), imported, selected);
            if (issue) throw new Error(issue);
            if (protectedPairs.some(pair => !imported.some(row => pairKey(row) === pairKey(pair)))) throw new Error('CSV changes a protected fixture.');
            edited(); setBaseline(pairs || []); setPairs(imported);
          } catch (cause) { setError(cause instanceof Error ? cause.message : 'CSV import failed.'); }
          event.target.value = '';
        }} /></label>
      </div>
      {pairs && <><h4>Review pairings</h4><p>{gains.size} managers / {gainingTeams.size} teams gain a confirmed missing flag. {changedTeams.size} teams have a new opponent or venue compared with the previous proposal.</p>
        <Button type="button" variant="secondaryAction" size="sm" onClick={() => setShowOpportunities(value => !value)}>{showOpportunities ? 'Hide collecting opportunities' : 'Review collecting opportunities'}</Button>
        {showOpportunities && <div>{analyzeFlagRoster(flagRoster(selected.filter(team => checks[team.id]?.state === 'free' || playingIds.has(team.id))), effectiveFlags, `${tournamentId}:${slotId}`).priorities.map(row => <p key={row.teamId}>
          {selected.find(team => team.ht_team_id === row.teamId)?.name}: {row.usefulOpponentIds.length} useful opponents · {gainingTeams.has(selected.find(team => team.ht_team_id === row.teamId)?.id || '') ? 'missing flag selected' : row.status === 'collecting' ? 'opportunity not selected; manager coverage and repair stability may take precedence' : row.status === 'complete' ? 'collection complete; can provide flags to others' : row.status === 'unknown' ? 'collection data uncertain' : 'no confirmed useful opponent in this roster'}.
        </p>)}</div>}
        {pairs.map((pair, index) => {
          const benefit = pairingBenefits(pair, selected, effectiveFlags), isLocked = locked(pair);
          const previousOpponent = context.history.some(match => match.round_id !== roundId && pair.homeTeamId && pair.awayTeamId &&
            ((match.home_team_id === pair.homeTeamId && match.away_team_id === pair.awayTeamId) || (match.away_team_id === pair.homeTeamId && match.home_team_id === pair.awayTeamId)));
          return <div key={index} className={styles.pair}>
            {(['homeTeamId', 'awayTeamId'] as const).map((side, sideIndex) => <label key={side}>{sideIndex ? 'Away' : 'Home'}<select disabled={isLocked} aria-label={`Fixture ${index + 1} ${sideIndex ? 'away' : 'home'} team`} value={pair[side] || ''} onChange={event => updatePair(index, { [side]: event.target.value || null })}>
              <option value="">BYE</option>{selected.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select></label>)}
            <Button type="button" size="xs" variant="secondaryAction" disabled={isLocked} onClick={() => updatePair(index, { homeTeamId: pair.awayTeamId, awayTeamId: pair.homeTeamId })}>Swap venue</Button>
            <Button type="button" size="xs" variant="secondaryAction" disabled={isLocked} onClick={() => { edited(); setPairs(rows => rows!.filter((_, i) => i !== index)); }}>Remove</Button>
            <small>{isLocked ? 'Protected booking / fixture. ' : baseline.some(row => pairKey(row) === pairKey(pair)) ? 'Unchanged. ' : 'Changed / new. '}
              {benefit ? `Home: ${benefit.home}${benefit.home === 'gain' ? ` (${benefit.homeCountry})` : ''}; away: ${benefit.away}${benefit.away === 'gain' ? ` (${benefit.awayCountry})` : ''}.` : 'BYE.'}
              {previousOpponent ? ' Previous or other scheduled opponent — review repeat.' : ''}{kickoffs[index] ? ` Kickoff: ${new Date(kickoffs[index]!).toLocaleString()}` : ''}</small>
          </div>;
        })}
        <Button type="button" size="sm" variant="secondaryAction" onClick={() => { edited(); setPairs(rows => [...rows!, { homeTeamId: null, awayTeamId: null, isBye: true }]); }}>Add fixture / BYE</Button>
        {validation && <p role="status">{validation}</p>}{kickoffError && <p role="alert">{kickoffError}</p>}
        {incompatible && <p role="alert">Resolve same-manager or known incompatible-gender pairings before saving.</p>}
        {pastKickoff && <p role="alert">A planned kickoff has passed. Change the venue, roster, or slot.</p>}
        {previewIssue && <p role="alert">{previewIssue} Recheck unclear offers, resolve outgoing challenges, or use Preview minimal-change repair; then review the pairings.</p>}
        <p>{playingRoster.filter(row => row.participation === 'admit').length} continuing admissions. Other non-active participants keep their membership.</p>
        <Button type="button" disabled={Boolean(validation || kickoffError || incompatible || pastKickoff || previewIssue)} onClick={() => void save()}>{roundId ? 'Verify and apply repair' : 'Verify and save counted round'}</Button>
        {finalRun && <Button type="button" variant="secondaryAction" onClick={() => void save(true)}>Retry / resume final verification</Button>}
        {progress && <p role="status" aria-live="polite">{progress}</p>}
        {error && <p role="alert">{error}</p>}
      </>}
    </fieldset>}
  </section>;
}
