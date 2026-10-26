import { useState } from 'react';
import { useClientNow } from '../../../hooks/useHydratedBrowserState';
import { Button } from '../../Button/Button';
import {
  generateOrganizerPairings,
  validateOrganizerPairings,
  serializeOrganizerPairings,
  type OrganizerRoundTeam,
  type OrganizerRoundSelection,
  type OrganizerRoundHistory,
  type RoundParticipation,
} from '../../../utils/organizer-round';
import { formatCalendarDate, type CalendarSlot } from '../../../utils/hattrick-calendar';
import type { LengthSchedulePairing } from '../../../utils/length-schedule';
import styles from './OrganizerRoundPanel.module.sass';

type Slot = Omit<CalendarSlot, 'nominalDate'> & { nominalDate: string };
interface Context {
  teams: OrganizerRoundTeam[];
  slots: Slot[];
  history: OrganizerRoundHistory[];
  rosterVersion: string;
}

function teamGroup(team: OrganizerRoundTeam) {
  return team.active ? 'active' : team.reserve_active ? 'lobby' : 'past';
}

export function OrganizerRoundPanel({ tournamentId, onChanged, canOverride }: {
  tournamentId: string;
  onChanged: () => Promise<void>;
  canOverride: boolean;
}) {
  const now = useClientNow(30_000);
  const [context, setContext] = useState<Context | null>(null);
  const [selection, setSelection] = useState<OrganizerRoundSelection[]>([]);
  const [slotId, setSlotId] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [pairs, setPairs] = useState<LengthSchedulePairing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const available = context?.teams.filter(team => !team.is_placeholder) || [];
  const shown = available.filter(team =>
    (group === 'all' || teamGroup(team) === group) && team.name.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = available.filter(team => selection.some(row => row.teamId === team.id));
  const admissions = selection.filter(row => row.participation === 'admit').length;
  const slot = context?.slots.find(value => value.id === slotId);
  const calendarSlot = slot ? { ...slot, nominalDate: new Date(slot.nominalDate) } : null;
  const validation = pairs ? validateOrganizerPairings(selection, pairs, selected) : null;
  let kickoffs: ReturnType<typeof serializeOrganizerPairings> = [];
  let kickoffError: string | null = null;
  if (pairs && calendarSlot && !validation) {
    try {
      kickoffs = serializeOrganizerPairings(calendarSlot, pairs, selected);
    } catch (cause) {
      kickoffError = cause instanceof Error ? cause.message : 'Could not calculate planned kickoffs.';
    }
  }
  const pastKickoff = kickoffs.some(match => new Date(match.scheduled_for).getTime() <= now);

  async function load() {
    setBusy(true);
    setError(null);
    setPairs(null);
    try {
      const response = await fetch(`/api/app?route=organizer-round&tournamentId=${encodeURIComponent(tournamentId)}`, {
        credentials: 'same-origin', cache: 'no-store',
      });
      const data = await response.json() as Context & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not load round options.');
      setContext(data);
      setSelection([]);
      setSlotId(data.slots[0]?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load round options.');
    } finally {
      setBusy(false);
    }
  }

  function choose(team: OrganizerRoundTeam, checked: boolean) {
    setSelection(rows => checked
      ? [...rows.filter(row => row.teamId !== team.id), { teamId: team.id, participation: 'round_only' }]
      : rows.filter(row => row.teamId !== team.id));
    setPairs(null);
  }

  function chooseShown(checked: boolean) {
    setSelection(rows => checked
      ? [...rows, ...shown.filter(team => !rows.some(row => row.teamId === team.id))
          .map(team => ({ teamId: team.id, participation: 'round_only' as const }))]
      : rows.filter(row => !shown.some(team => team.id === row.teamId)));
    setPairs(null);
  }

  function changeParticipation(teamId: string, participation: RoundParticipation) {
    setSelection(rows => rows.map(row => row.teamId === teamId ? { ...row, participation } : row));
  }

  function updatePair(index: number, changes: Partial<LengthSchedulePairing>) {
    setPairs(rows => rows?.map((row, i) => i === index ? { ...row, ...changes } : row) ?? null);
  }

  async function save() {
    if (!context || !pairs || validation || kickoffError || pastKickoff) return;
    const confirmation = `Save this counted regular round with ${selection.length} teams and ${pairs.length} fixtures?\n` +
      `${admissions} teams selected for continuing admission.` +
      (canOverride ? '\nExisting organizer overrides apply to admissions; fixtures and history remain protected.' : '');
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/app?route=organizer-round', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId, slotId, rosterVersion: context.rosterVersion, roster: selection, pairings: pairs }),
      });
      const result = await response.json() as { error?: string; roundNumber?: number };
      if (!response.ok) throw new Error(result.error || 'Could not save the round.');
      setContext(null);
      setPairs(null);
      setSelection([]);
      setSuccess(`Round ${result.roundNumber} saved. Its fixtures are available in Fixtures & Results.`);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the round.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Add regular round">
      <h3>Add regular round</h3>
      <p>Choose an additional friendly slot and its teams. Results count in this season. No participant signup is needed.</p>
      <Button type="button" variant="secondaryAction" disabled={busy} onClick={() => void load()}>
        {busy ? 'Working…' : context ? 'Reload roster and slots' : 'Choose teams and slot'}
      </Button>
      {success && <p role="status">{success}</p>}
      {error && <p role="alert">{error}</p>}
      {context && (
        <fieldset disabled={busy} className={styles.form}>
          {!context.slots.length ? <p>No unused friendly slots remain before this season’s playoffs.</p> : <>
            <label>
              Calendar slot
              <select aria-label="Calendar slot" value={slotId} onChange={event => { setSlotId(event.target.value); setPairs(null); }}>
                {context.slots.map(value => (
                  <option key={value.id} value={value.id}>
                    {formatCalendarDate(new Date(value.nominalDate))} — {value.kind === 'weekend_friendly' ? 'Weekend' : 'Midweek'} (W{value.htWeek})
                  </option>
                ))}
              </select>
            </label>
            {slot?.warning && <p>{slot.warning}</p>}
            <p>Hattrick availability is checked during booking. Existing bookings and qualification games may prevent a friendly; selecting a team here does not cancel its other matches.</p>
            <div className={styles.controls}>
              <label>Search teams <input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
              <label>
                Group
                <select aria-label="Team group" value={group} onChange={event => setGroup(event.target.value)}>
                  <option value="all">All teams</option>
                  <option value="active">Active</option>
                  <option value="lobby">Lobby</option>
                  <option value="past">Past</option>
                </select>
              </label>
              <Button type="button" variant="secondaryAction" size="sm" onClick={() => chooseShown(true)}>Select shown</Button>
              <Button type="button" variant="secondaryAction" size="sm" onClick={() => chooseShown(false)}>Clear shown</Button>
            </div>
            <p>{selection.length} teams selected</p>
            <div className={styles.roster}>
              {shown.map(team => {
                const entry = selection.find(row => row.teamId === team.id);
                return (
                  <div key={team.id} className={styles.team}>
                    <label>
                      <input type="checkbox" checked={Boolean(entry)} onChange={event => choose(team, event.target.checked)} />
                      {team.name} <small>({teamGroup(team)})</small>
                    </label>
                    {entry && !team.active && (
                      <select aria-label={`Participation for ${team.name}`} value={entry.participation}
                        onChange={event => changeParticipation(team.id, event.target.value as RoundParticipation)}>
                        <option value="round_only">This round only</option>
                        <option value="admit">Admit for subsequent rounds</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <Button type="button" disabled={selection.length < 2}
              onClick={() => { setPairs(generateOrganizerPairings(selected, context.history)); setError(null); }}>
              Preview pairings
            </Button>
            {pairs && <>
              <h4>Review pairings</h4>
              <p>Edit opponents or swap venues. Every selected team must appear once; select BYE for an unmatched side.</p>
              {pairs.map((pair, index) => (
                <div key={index} className={styles.pair}>
                  {(['homeTeamId', 'awayTeamId'] as const).map((side, sideIndex) => (
                    <label key={side}>
                      {sideIndex ? 'Away' : 'Home'}
                      <select aria-label={`Fixture ${index + 1} ${sideIndex ? 'away' : 'home'} team`} value={pair[side] || ''}
                        onChange={event => updatePair(index, { [side]: event.target.value || null })}>
                        <option value="">BYE</option>
                        {selected.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
                      </select>
                    </label>
                  ))}
                  <Button type="button" size="xs" variant="secondaryAction"
                    onClick={() => updatePair(index, { homeTeamId: pair.awayTeamId, awayTeamId: pair.homeTeamId })}>
                    Swap venue
                  </Button>
                  <Button type="button" size="xs" variant="secondaryAction"
                    onClick={() => setPairs(rows => rows?.filter((_, i) => i !== index) ?? null)}>
                    Remove
                  </Button>
                  {kickoffs[index] && <small>Estimated: {new Date(kickoffs[index].scheduled_for).toLocaleString()}</small>}
                </div>
              ))}
              <Button type="button" size="sm" variant="secondaryAction"
                onClick={() => setPairs(rows => [...(rows || []), { homeTeamId: null, awayTeamId: null, isBye: true }])}>
                Add fixture / BYE
              </Button>
              {validation && <p role="status">{validation}</p>}
              {kickoffError && <p role="alert">{kickoffError}</p>}
              {pastKickoff && <p role="status">A planned kickoff has passed. Change the venue, roster, or slot before saving.</p>}
              <p>{admissions} continuing admissions; all other non-active teams keep their current membership.</p>
              <Button type="button" disabled={Boolean(validation || kickoffError) || pastKickoff} onClick={() => void save()}>Save counted round</Button>
            </>}
          </>}
        </fieldset>
      )}
    </section>
  );
}
