'use client';

import { useEffect, useState } from 'react';
import { Button } from '../Button/Button';
import { loadManageableCollections, saveTournamentCollectionMembership } from '../../app/_data/tournament-actions';
import styles from './CollectionMembershipPanel.module.sass';

type Row = Awaited<ReturnType<typeof loadManageableCollections>>[number];

export function CollectionMembershipPanel({ tournamentId }: { tournamentId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadManageableCollections(tournamentId).then((result) => {
      if (mounted) setRows(result);
    }).catch((cause: unknown) => {
      if (mounted) setError(cause instanceof Error ? cause.message : 'Could not load collections.');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [tournamentId]);

  const update = (id: string, patch: Partial<Row>) => {
    setSavedId(null);
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const save = async (row: Row) => {
    setSaving(row.id);
    setError('');
    try {
      await saveTournamentCollectionMembership(tournamentId, row.id, {
        isMember: row.isMember, displayOrder: row.displayOrder,
      });
      setSavedId(row.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save membership.');
    } finally {
      setSaving(null);
    }
  };

  return <div className={styles.panel}>
    <h3>Collections</h3>
    <p>Membership follows this tournament across seasons.</p>
    {loading && <p>Loading collections…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && rows.length === 0 && <p>No collections are available yet.</p>}
    {rows.map((row) => <div className={styles.row} key={row.id}>
      <label><input type="checkbox" checked={row.isMember}
        onChange={(event) => update(row.id, { isMember: event.target.checked })} /> {row.title}{!row.isPublished && ' (draft)'}</label>
      {row.isMember && <>
        <label>Order <input type="number" min="0" max="10000" value={row.displayOrder}
          onChange={(event) => update(row.id, { displayOrder: Number(event.target.value) })} /></label>
      </>}
      <Button type="button" size="sm" variant="secondaryAction" disabled={saving === row.id}
        onClick={() => void save(row)}>{saving === row.id ? 'Saving…' : 'Save'}</Button>
      {savedId === row.id && <span role="status">Saved</span>}
    </div>)}
  </div>;
}
