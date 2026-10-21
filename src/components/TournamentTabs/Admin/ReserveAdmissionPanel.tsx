'use client';
import { useState } from 'react';
import { Button } from '../../Button/Button';

type Check = {
  roundId: string; roundNumber: number; canAdmit: boolean; newFieldSize: number; maxTeams: number | null;
  statuses: Array<{ teamId: string; name: string; inCup: boolean | null; booked: boolean | null; error: string | null; warnings?: string[] }>;
  matches: Array<{ home_team_id: string; away_team_id: string; scheduled_for: string }>;
  pairs: Array<{ home: string; away: string; scheduledFor: string }>;
};

export function ReserveAdmissionPanel({ tournamentId, teamIds, isSiteAdmin, onChanged }: {
  tournamentId: string; teamIds: string[]; isSiteAdmin: boolean; onChanged: () => void | Promise<void>;
}) {
  const [checked, setChecked] = useState<{ selection: string; result: Check; requestId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selection = [...teamIds].sort().join(',');
  const preview = checked?.selection === selection ? checked : null;
  async function submit(admit: boolean) {
    if (admit && !preview) return;
    const raiseLimit = Boolean(preview && preview.result.maxTeams !== null && preview.result.maxTeams > 0 && preview.result.newFieldSize > preview.result.maxTeams);
    const eligibilityWarnings = [...new Set(preview?.result.statuses.flatMap(status => status.warnings ?? []) ?? [])];
    const warningText = isSiteAdmin && eligibilityWarnings.length
      ? `\n\nSite-admin warnings: ${eligibilityWarnings.join(' ')}`
      : '';
    const capacityText = raiseLimit
      ? isSiteAdmin
        ? `\n\nWarning: this will exceed the configured team limit of ${preview!.result.maxTeams}. The limit setting will stay unchanged.`
        : ` Increase the team limit to ${preview!.result.newFieldSize}.`
      : '';
    if (admit && !window.confirm(`Add ${teamIds.length} Waiting teams to Round ${preview!.result.roundNumber}? Existing fixtures stay unchanged.${capacityText}${warningText}`)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/app?route=reserve-admission', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId, teamIds, action: admit ? 'admit' : 'check', roundId: preview?.result.roundId, requestId: preview?.requestId, expectedMatches: preview?.result.matches, raiseLimit }) });
      const data = await response.json();
      if (!response.ok) {
        if (data.roundId && Array.isArray(data.statuses)) setChecked({ selection, result: data as Check, requestId: preview?.requestId || crypto.randomUUID() });
        throw new Error(data.error || 'Waiting teams could not be admitted.');
      }
      if (admit) { setChecked(null); await onChanged(); }
      else setChecked({ selection, result: data as Check, requestId: crypto.randomUUID() });
    } catch (e) { setError(e instanceof Error ? e.message : 'Waiting team check failed.'); }
    finally { setBusy(false); }
  }
  if (!teamIds.length) return <p>Choose Waiting teams above to add newcomer pairs to this round.</p>;
  if (teamIds.length < 2 || teamIds.length % 2) return <p>Choose an even number of Waiting teams (at least two). Selected: {teamIds.length}.</p>;
  return <div>
    <Button type="button" variant="secondaryAction" disabled={busy} onClick={() => void submit(false)}>{busy ? 'Working...' : `Check Waiting teams booking status (${teamIds.length} selected)`}</Button>
    {error && <p role="alert">{error}</p>}
    {preview && <>
      <p>Entry: Round {preview.result.roundNumber}. Existing fixtures stay unchanged.</p>
      <ul>{preview.result.statuses.map(status => <li key={status.teamId}>{status.name}: {status.error || (status.inCup ? 'In cup' : status.booked ? 'Booked' : status.inCup === null ? 'Cup status unavailable' : status.booked === null ? 'Booking status unavailable' : 'Available')}{status.warnings?.length ? ` · Eligibility warning: ${status.warnings.join(' ')}` : ''}</li>)}</ul>
      {preview.result.pairs.map(pair => <p key={`${pair.home}:${pair.away}`}>{pair.home} vs {pair.away} · {new Date(pair.scheduledFor).toLocaleString('en-GB', { timeZone: 'Europe/Stockholm' })} HT time</p>)}
      <Button type="button" disabled={busy || !preview.result.canAdmit} onClick={() => void submit(true)}>Add {teamIds.length} Waiting teams to Round {preview.result.roundNumber}</Button>
    </>}
  </div>;
}
