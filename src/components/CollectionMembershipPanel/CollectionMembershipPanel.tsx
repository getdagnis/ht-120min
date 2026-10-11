'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '../Button/Button';
import { loadManageableCollections, saveTournamentCollectionMembership } from '../../app/_data/tournament-actions';
import styles from './CollectionMembershipPanel.module.sass';

type Row = Awaited<ReturnType<typeof loadManageableCollections>>[number];

export function CollectionMembershipPanel({ tournamentId }: { tournamentId: string }) {
  const uiText = useTranslations('PublicUI.CollectionMembershipPanel');
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
    <h3>{uiText('collections')}</h3>
    <p>{uiText('membershipFollowsThisTournamentAcrossSeasons')}</p>
    {loading && <p>{uiText('loadingCollections')}</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && rows.length === 0 && <p>{uiText('noCollectionsAreAvailableYet')}</p>}
    {rows.map((row) => <div className={styles.row} key={row.id}>
      <label><input type="checkbox" checked={row.isMember}
        onChange={(event) => update(row.id, { isMember: event.target.checked })} /> {row.title}{!row.isPublished && ' (draft)'}</label>
      {row.isMember && <>
        <label>{uiText('order')} <input type="number" min="0" max="10000" value={row.displayOrder}
          onChange={(event) => update(row.id, { displayOrder: Number(event.target.value) })} /></label>
      </>}
      <Button type="button" size="sm" variant="secondaryAction" disabled={saving === row.id}
        onClick={() => void save(row)}>{saving === row.id ? uiText('saving') : uiText('save')}</Button>
      {savedId === row.id && <span role="status">{uiText('saved')}</span>}
    </div>)}
  </div>;
}
