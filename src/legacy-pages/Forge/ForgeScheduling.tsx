import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import type { SlotObservation } from '../../../shared/organizer-planning';
import styles from './ForgeScheduling.module.sass';

type Team = { id: string; tournament_id: string; name: string; ht_team_id: number | null; active: boolean; reserve_active: boolean; manager_name: string | null };
type Data = { rounds: Array<{ id: string; tournament_id: string; round_number: number; phase_status: string | null }>; fixtures: Array<{ id: string; round_id: string; home_team_id: string | null; away_team_id: string | null; scheduled_for: string | null; ht_match_id: number | null }>; collections: Array<{ id: string; title: string }>; selectedCollection: string; selectedSlot: string; slots: Array<{ id: string; htSeason: number; htWeek: number; kind: string }>; tournaments: Array<{ id: string; name: string }>; teams: Team[]; observations: Array<{ ht_team_id: number; observation: SlotObservation }>; batchSize: number };
function status(check?: SlotObservation) {
  if (!check || check.state === 'unknown') return 'Unknown';
  if (check.state === 'booked') return 'Booked';
  if (check.state === 'blocked') return check.matchType === 2 ? 'Qualifier' : 'Other blocked';
  if (!check.challengesKnown) return 'No match · offers unknown';
  if (check.pendingOpponentIds.length) return 'No match · outgoing offers';
  return 'Available';
}
const membership = (team: Team) => team.active ? 'Active' : team.reserve_active ? 'Lobby' : 'Past';
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export function ForgeScheduling() {
  const [data, setData] = useState<Data | null>(null), [collection, setCollection] = useState(''), [slot, setSlot] = useState('');
  const [error, setError] = useState(''), [progress, setProgress] = useState(''), [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<string[]>(['Active', 'Lobby', 'Past']);
  async function load(collectionId = collection, slotId = slot) {
    setError('');
    try {
      const params = new URLSearchParams(); if (collectionId) params.set('collectionId', collectionId); if (slotId) params.set('slotId', slotId);
      const response = await fetch(`/api/testing/scheduling?${params}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load scheduling.');
      setData(body); setCollection(body.selectedCollection); setSlot(body.selectedSlot);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load scheduling.'); }
  }
  useEffect(() => { void load('', ''); }, []);
  const checks = useMemo(() => new Map(data?.observations.map(row => [row.ht_team_id, row.observation]) || []), [data]);
  async function scan(ids: number[]) {
    if (!data || busy || !ids.length) return;
    setBusy(true); setError(''); let completed = 0;
    try {
      for (let i = 0; i < ids.length; i += data.batchSize) {
        setProgress(`Checking ${completed}/${ids.length}`);
        const response = await fetch('/api/testing/scheduling', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collectionId: collection, slotId: slot, teamIds: ids.slice(i, i + data.batchSize) }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Batch failed. Retry remaining teams.');
        setData(previous => previous ? { ...previous, observations: [...previous.observations.filter(row => !body.results.some((result: { ht_team_id: number }) => result.ht_team_id === row.ht_team_id)), ...body.results] } : previous);
        completed += body.results.length;
      }
      setProgress(`Finished: ${completed}/${ids.length}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Scan failed.'); setProgress(`Stopped: ${completed}/${ids.length}. Resume to retry unchecked teams.`); }
    finally { setBusy(false); }
  }
  const chosen = (team: Team) => groups.includes(membership(team));
  const ids = [...new Set(data?.teams.flatMap(team => chosen(team) && team.ht_team_id ? [team.ht_team_id] : []) || [])];
  const pending = ids.filter(id => !checks.has(id) || checks.get(id)?.state === 'unknown' || !checks.get(id)?.challengesKnown);
  function exportCsv() {
    if (!data) return;
    const rows = [['Tournament','Team','Hattrick team ID','Membership','Status','Opponent ID','Kickoff','Outgoing offers','Incoming offers','Checked at']];
    for (const team of data.teams.filter(chosen)) { const check = checks.get(team.ht_team_id || 0), booking = check?.booking;
      rows.push([data.tournaments.find(t => t.id === team.tournament_id)?.name || '', team.name, String(team.ht_team_id || ''), membership(team), status(check), String(booking ? (booking.homeId === team.ht_team_id ? booking.awayId : booking.homeId) : ''), booking?.kickoff || '', (check?.pendingOpponentIds || []).join(' '), (check?.incomingOfferOpponentIds || []).join(' '), check?.checkedAt || '']); }
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `scheduling-${slot}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <SectionCard title="Scheduling"><div className={styles.workspace}>
    <h3>Availability</h3><p>Observations are snapshots; bookings can change after a check.</p>
    {error && <p role="alert">{error}</p>}{!data ? <p>Loading scheduling…</p> : <>
      <div className={styles.controls}><label>Collection <select disabled={busy} value={collection} onChange={event => { setCollection(event.target.value); void load(event.target.value, slot); }}>{data.collections.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>Friendly slot <select disabled={busy} value={slot} onChange={event => { setSlot(event.target.value); void load(collection, event.target.value); }}>{data.slots.map(item => <option key={item.id} value={item.id}>S{item.htSeason} · W{item.htWeek} · {item.kind === 'weekend_friendly' ? 'Weekend' : 'Midweek'}</option>)}</select></label></div>
      <div className={styles.controls}>{['Active', 'Lobby', 'Past'].map(group => <label key={group}><input type="checkbox" disabled={busy} checked={groups.includes(group)} onChange={event => setGroups(previous => event.target.checked ? [...previous, group] : previous.filter(value => value !== group))} /> {group}</label>)}</div>
      <div className={styles.controls}><Button disabled={busy || !ids.length} onClick={() => void scan(ids)}>Scan selected teams</Button><Button disabled={busy || !pending.length} onClick={() => void scan(pending)}>Resume / retry</Button><Button disabled={busy} onClick={exportCsv}>Export CSV</Button></div>
      <p aria-live="polite">{progress || `${data.tournaments.length} tournaments · ${ids.length} unique teams`}</p>
      {['Active','Lobby','Past'].map(group => { const members = data.teams.filter(team => membership(team) === group); return <p key={group}><strong>{group} ({members.length} registrations): </strong>{['Available','No match · outgoing offers','No match · offers unknown','Booked','Qualifier','Other blocked','Unknown'].map(label => ({ label, count: members.filter(team => status(checks.get(team.ht_team_id || 0)) === label).length })).filter(item => item.count || !['Other blocked', 'Unknown', 'No match · outgoing offers'].includes(item.label)).map(item => `${item.label}: ${item.count}`).join(' · ')}</p>; })}
      <h3>Tournament overview</h3>{data.tournaments.map(tournament => { const teams = data.teams.filter(team => team.tournament_id === tournament.id); return <details key={tournament.id}><summary>{tournament.name} · {teams.length} teams · {teams.filter(team => status(checks.get(team.ht_team_id || 0)) === 'Available').length} available · {teams.filter(team => status(checks.get(team.ht_team_id || 0)) === 'Booked').length} booked · {teams.filter(team => status(checks.get(team.ht_team_id || 0)) === 'Qualifier').length} qualifiers{teams.some(team => status(checks.get(team.ht_team_id || 0)) === 'Other blocked') && <> · {teams.filter(team => status(checks.get(team.ht_team_id || 0)) === 'Other blocked').length} other blocked</>}{teams.some(team => status(checks.get(team.ht_team_id || 0)) === 'Unknown') && <> · {teams.filter(team => status(checks.get(team.ht_team_id || 0)) === 'Unknown').length} unknown</>}</summary>
        <h4>Previous misarranged matches</h4>
        {(() => { const rounds = data.rounds.filter(round => round.tournament_id === tournament.id); const previous = data.fixtures.filter(fixture => rounds.some(round => round.id === fixture.round_id && (round.phase_status === 'completed' || Boolean(fixture.scheduled_for && Date.parse(fixture.scheduled_for) < Date.now())))); return previous.length ? previous.map(fixture => {
          const home = teams.find(team => team.id === fixture.home_team_id), away = teams.find(team => team.id === fixture.away_team_id);
          const h = home?.ht_team_id ? checks.get(home.ht_team_id) : undefined, a = away?.ht_team_id ? checks.get(away.ht_team_id) : undefined;
          const pairBooked = (check?: SlotObservation) => Boolean(home?.ht_team_id && away?.ht_team_id && check?.state === 'booked' && check.booking && [check.booking.homeId, check.booking.awayId].includes(home.ht_team_id) && [check.booking.homeId, check.booking.awayId].includes(away.ht_team_id));
          const label = pairBooked(h) || pairBooked(a) ? 'Existing booking between these teams' : !h || !a || h.state === 'unknown' || a.state === 'unknown' ? 'Availability unknown' : h.state !== 'free' && a.state !== 'free' ? 'Both occupied' : h.state !== 'free' || a.state !== 'free' ? 'One team occupied' : !h.challengesKnown || !a.challengesKnown ? 'Both have no booked match; challenge checks incomplete' : h.pendingOpponentIds.length || a.pendingOpponentIds.length ? 'Both have no booked match; outgoing challenges pending' : 'Both available';
          return <p key={fixture.id}>Round {rounds.find(round => round.id === fixture.round_id)?.round_number}: {home?.name || 'Unknown team'} vs {away?.name || 'Unknown team'} · <span className={label === 'Both available' ? styles.matchAvailable : label === 'Both occupied' ? styles.matchBothOccupied : label === 'One team occupied' ? styles.matchOccupied : undefined}>{label}</span>{fixture.ht_match_id ? ' · Original fixture has a linked Hattrick match; review' : ''}</p>;
        }) : <p>No previous misarranged matches found in this season.</p>; })()}
        <div className={styles.teams}>{teams.filter(chosen).map(team => { const check = checks.get(team.ht_team_id || 0), booking = check?.booking; return <div className={styles.team} key={team.id}><div><strong>{team.name}</strong> · {membership(team)} · {['Available', 'Qualifier', 'Booked'].includes(status(check)) ? <span className={`${styles.statusBadge} ${status(check) === 'Available' ? styles.available : status(check) === 'Qualifier' ? styles.qualifier : styles.booked}`}>{status(check) === 'Booked' ? 'Outside booked' : status(check)}</span> : status(check)}{booking && <span className={styles.date}> · {new Date(booking.kickoff).toLocaleString()}</span>}{check?.pendingOpponentIds.length ? <> · Outgoing: {check.pendingOpponentIds.join(', ')}</> : null}{check?.incomingOfferOpponentIds?.length ? <> · Incoming: {check.incomingOfferOpponentIds.join(', ')}</> : null}{check && !check.challengesKnown && <> · Outgoing offers unknown</>}{check && !check.incomingOffersKnown && <> · Incoming offers unknown</>}<span className={styles.date}> · {check?.checkedAt ? `Checked ${new Date(check.checkedAt).toLocaleString()}` : 'Not checked'}</span></div><Button disabled={busy || !team.ht_team_id} onClick={() => team.ht_team_id && void scan([team.ht_team_id])}>Recheck</Button></div>; })}</div></details>; })}
    </>}
  </div></SectionCard>;
}
