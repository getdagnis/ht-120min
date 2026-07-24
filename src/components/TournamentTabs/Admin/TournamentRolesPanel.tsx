import { useState } from 'react';
import { Trash } from 'phosphor-react';

import { Button } from '../../Button/Button';
import adminStyles from '../../../pages/Public/TournamentAdmin.module.sass';
import { TOURNAMENT_ROLE_LABELS, type TournamentRole } from '../../../../shared/tournament-roles';

export interface TournamentRoleRecord {
  id: string;
  hattrick_user_id: number;
  role: TournamentRole;
  manager_name?: string | null;
}

export interface TournamentOwnerRecord {
  hattrick_user_id: number | null;
  manager_name: string | null;
}

interface TournamentRolesPanelProps {
  tournamentId: string;
  roles: TournamentRoleRecord[];
  originalOrganizer: TournamentOwnerRecord;
  canManageAdmins: boolean;
  canManagePressOfficer: boolean;
  canManageCoOrganizer: boolean;
  onRolesChanged: (roles: TournamentRoleRecord[]) => void;
}

export function TournamentRolesPanel({
  tournamentId,
  roles,
  originalOrganizer,
  canManageAdmins,
  canManagePressOfficer,
  canManageCoOrganizer,
  onRolesChanged,
}: TournamentRolesPanelProps) {
  const [role, setRole] = useState<TournamentRole>('admin');
  const [hattrickUserId, setHattrickUserId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const mutateRole = async (body: Record<string, unknown>) => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/app?route=tournament-roles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId, ...body }),
      });
      const payload = (await response.json()) as { error?: string; roles?: TournamentRoleRecord[] };
      if (!response.ok) throw new Error(payload.error || 'Could not update tournament roles.');
      onRolesChanged(payload.roles || []);
      setHattrickUserId('');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not update tournament roles.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={adminStyles.rolesPanel}>
      <div className={adminStyles.roleGroup}>
        <div className={adminStyles.roleGroupHeader}><strong>Original organiser</strong><span>Permanent tournament owner</span></div>
        <div className={adminStyles.roleRow}>
          <div>
            <strong>{originalOrganizer.manager_name || `Hattrick user ${originalOrganizer.hattrick_user_id || 'unknown'}`}</strong>
            <span>Organiser{originalOrganizer.hattrick_user_id ? ` · ID ${originalOrganizer.hattrick_user_id}` : ''}</span>
          </div>
        </div>
      </div>
      {(['co_organizer', 'admin', 'press_officer'] as TournamentRole[]).map((groupRole) => {
        const groupRoles = roles.filter((assignedRole) => assignedRole.role === groupRole);
        const canManageGroup = groupRole === 'co_organizer' ? canManageCoOrganizer : groupRole === 'admin' ? canManageAdmins : canManagePressOfficer;
        return (
          <div key={groupRole} className={adminStyles.roleGroup}>
            <div className={adminStyles.roleGroupHeader}>
              <strong>{TOURNAMENT_ROLE_LABELS[groupRole]}</strong>
              <span>{groupRole === 'admin' ? `${groupRoles.length} / 4` : `${groupRoles.length} / 1`}</span>
            </div>
            {groupRoles.length === 0 ? <p className={adminStyles.smallNote}>Not assigned.</p> : groupRoles.map((assignedRole) => (
            <div key={assignedRole.id} className={adminStyles.roleRow}>
              <div>
                <strong>{assignedRole.manager_name || `Hattrick user ${assignedRole.hattrick_user_id}`}</strong>
                <span>{TOURNAMENT_ROLE_LABELS[assignedRole.role]} · ID {assignedRole.hattrick_user_id}</span>
              </div>
              {canManageGroup && (
                <button
                  type="button"
                  className={adminStyles.iconBtn}
                  title="Remove role"
                  aria-label={`Remove ${TOURNAMENT_ROLE_LABELS[assignedRole.role]}`}
                  onClick={() => {
                    if (window.confirm('Remove this delegated role?')) void mutateRole({ action: 'remove', hattrickUserId: assignedRole.hattrick_user_id });
                  }}
                  disabled={isSaving}
                >
                  <Trash size={18} weight="bold" />
                </button>
              )}
            </div>
            ))}
          </div>
        );
      })}
      {(canManageAdmins || canManagePressOfficer || canManageCoOrganizer) && (
        <div className={adminStyles.roleForm}>
          <input
            type="number"
            min="1"
            value={hattrickUserId}
            onChange={(event) => setHattrickUserId(event.target.value)}
            placeholder="Hattrick manager ID"
            aria-label="Hattrick manager ID"
          />
          <select value={role} onChange={(event) => setRole(event.target.value as TournamentRole)} aria-label="Tournament role">
            {Object.entries(TOURNAMENT_ROLE_LABELS)
              .filter(([value]) => value !== 'co_organizer' || canManageCoOrganizer)
              .filter(([value]) => value !== 'admin' || canManageAdmins)
              .filter(([value]) => value !== 'press_officer' || canManagePressOfficer)
              .map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={isSaving || !hattrickUserId.trim()}
            onClick={() => void mutateRole({ action: 'assign', hattrickUserId: Number(hattrickUserId), role })}
          >
            {isSaving ? 'Saving...' : 'Assign role'}
          </Button>
        </div>
      )}
      {!canManageAdmins && !canManagePressOfficer && !canManageCoOrganizer && <p className={adminStyles.smallNote}>Role changes are restricted to the organiser and co-organiser.</p>}
    </div>
  );
}
