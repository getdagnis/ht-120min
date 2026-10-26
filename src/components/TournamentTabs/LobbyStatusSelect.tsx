import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getLobbyStatus, LOBBY_STATUSES, type CurrentParticipantTeamState, type LobbyStatus } from '../../utils/team-state';

export function LobbyStatusSelect({ tournamentId, team, onChanged, canEdit = true }: {
  tournamentId: string;
  team: CurrentParticipantTeamState & { id: string; name: string };
  onChanged: () => void | Promise<void>;
  canEdit?: boolean;
}) {
  const text = useTranslations('lobby');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = getLobbyStatus(team);
  async function change(next: LobbyStatus) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/app?route=lobby-status', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId, teamId: team.id, status: next }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || text('saveError'));
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('saveError'));
    } finally { setBusy(false); }
  }
  return <div>
    {canEdit ? <select aria-label={text('statusForTeam', { team: team.name })} value={status} disabled={busy} onChange={(event) => void change(event.target.value as LobbyStatus)}>
      {LOBBY_STATUSES.map(value => <option key={value} value={value}>{text(value)}</option>)}
    </select> : <span>{text(status)}</span>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
