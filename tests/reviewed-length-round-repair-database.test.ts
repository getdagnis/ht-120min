import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const socket = process.env.HT120_TEST_POSTGRES_SOCKET;
const container = process.env.HT120_TEST_POSTGRES_CONTAINER;
const enabled = Boolean(container || socket?.startsWith('/private/tmp/ht120-calendar-pg.') || socket?.startsWith('/tmp/ht120-calendar-pg.'));
const sql = (input: string) => execFileSync(container ? 'docker' : 'psql', container
  ? ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q']
  : ['-h', socket!, '-p', '55442', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'],
{ input, encoding: 'utf8' });
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const snapshot = () => {
  const rows = JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'home_team_id',home_team_id,
    'away_team_id',away_team_id,'ht_match_id',ht_match_id,'status',status,
    'schedule_resolution',schedule_resolution) ORDER BY id) FROM matches WHERE round_id='${id(20)}';`));
  return { ids: rows.map((row: { id: string }) => row.id), rows };
};
const array = (ids: string[]) => `ARRAY[${ids.map(value => `'${value}'::uuid`).join(',')}]::uuid[]`;
const json = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

test('reviewed round repair preserves booked rows, admits one Lobby team, and rejects stale or dependent fixtures',
  { skip: !enabled }, () => {
    sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    sql(readFileSync(new URL('./fixtures/calendar-schedule-schema.sql', import.meta.url), 'utf8'));
    sql(`ALTER TABLE tournaments ADD max_teams integer, ADD is_test boolean, ADD is_archived boolean, ADD registration_type text;
      ALTER TABLE teams ADD reserve_joined_at timestamptz;
      ALTER TABLE rounds ADD round_source text DEFAULT 'scheduled', ADD is_unscored boolean DEFAULT false;
      ALTER TABLE matches ADD finished_at timestamptz, ADD reserve_team_id uuid, ADD match_type integer, ADD chpp_match_date timestamptz,
        ADD actual_ht_home_team_id bigint, ADD actual_ht_away_team_id bigint;
      ALTER TABLE tournament_season_slot_assignments ADD assigned_at timestamptz DEFAULT now(), ADD admission_request_id uuid,
        ADD entry_round_id uuid, ADD ranking_source text, ADD ranking_value numeric;
      ALTER TABLE tournament_season_slots ADD CHECK(box_size>0 AND mod(box_size,2)=0 AND slot_index<=box_size);
      CREATE TABLE match_120m_ratings(match_id uuid);
      CREATE TABLE fixture_predicted_rating_shares(fixture_id uuid);
      CREATE TABLE fixture_rating_automation(fixture_id uuid);
      CREATE TABLE forge_booking_worker_runs(fixture_id uuid);
      CREATE TABLE fixture_warnings(round_id uuid,team_id uuid,active boolean);`);
    sql(readFileSync(new URL('../migrations/167_reviewed_length_round_repair.sql', import.meta.url), 'utf8'));
    sql(`INSERT INTO tournaments(id,season,league_category,status,schedule_mode,max_teams)
      VALUES('${id(10)}',1,'male','active','length',5);
      INSERT INTO tournament_seasons(id,tournament_id,season_number,status)
      VALUES('${id(11)}','${id(10)}',1,'ongoing');
      INSERT INTO rounds(id,tournament_id,season_number,round_number,phase,phase_status,round_source,reserved_slot_kind,reserved_slot_date)
      VALUES('${id(20)}','${id(10)}',1,3,'regular','materialized','scheduled','midweek_friendly','2030-03-19T18:25:00Z');
      ${Array.from({ length: 5 }, (_, n) => `INSERT INTO teams(id,tournament_id,name,ht_team_id,active,reserve_active,power_rating)
        VALUES('${id(n + 1)}','${id(10)}','Team ${n + 1}',${n + 1},${n < 4},${n === 4},${1000 + n});`).join('\n')}
      ${Array.from({ length: 4 }, (_, n) => `INSERT INTO tournament_season_slots(id,tournament_season_id,slot_index,box_size,current_team_id)
        VALUES('${id(31 + n)}','${id(11)}',${n + 1},4,'${id(n + 1)}');
        INSERT INTO tournament_season_slot_assignments(tournament_season_slot_id,team_id,reason)
        VALUES('${id(31 + n)}','${id(n + 1)}','schedule_backfill');`).join('\n')}
      INSERT INTO matches(id,round_id,home_team_id,away_team_id,status,completed,schedule_resolution,ht_match_id,scheduled_for)
      VALUES('${id(40)}','${id(20)}','${id(1)}','${id(2)}','arranged',false,'pending',123,'2030-03-19T18:25:00Z'),
        ('${id(41)}','${id(20)}','${id(3)}','${id(4)}','not_arranged',false,'pending',NULL,'2030-03-19T18:25:00Z');`);
    const before = snapshot();
    const proposal = [
      { home_team_id: id(3), away_team_id: id(5), scheduled_for: '2030-03-19T18:25:00Z', schedule_resolution: 'pending' },
      { home_team_id: id(4), away_team_id: null, scheduled_for: '2030-03-19T18:25:00Z', schedule_resolution: 'pending' },
    ];
    const apply = (current = before, kept = [id(40)], lobby = [id(5)], fixtures: unknown = proposal) =>
      `SELECT apply_reviewed_length_round_repair('${id(10)}',1,'${id(20)}',
        ${array(current.ids)},${json(current.rows)},${array(kept)},${array(lobby)},${json(fixtures)});`;
    sql(`INSERT INTO fixture_predicted_rating_shares(fixture_id) VALUES('${id(41)}');`);
    assert.throws(() => sql(apply()), /dependent records/);
    assert.deepEqual(snapshot(), before);
    assert.equal(sql(`SELECT active FROM teams WHERE id='${id(5)}';`).trim(), 'f');
    sql(`DELETE FROM fixture_predicted_rating_shares WHERE fixture_id='${id(41)}';`);
    assert.match(sql(apply()), /"admitted": 1/);
    assert.equal(sql(`SELECT count(*) FROM matches WHERE id='${id(40)}' AND ht_match_id=123;`).trim(), '1');
    assert.equal(sql('SELECT count(*) FROM matches;').trim(), '3');
    assert.equal(sql('SELECT count(*) FROM tournament_season_slots;').trim(), '6');
    assert.equal(sql('SELECT count(*) FROM tournament_season_slots WHERE current_team_id IS NULL;').trim(), '1');
    assert.equal(sql(`SELECT active FROM teams WHERE id='${id(5)}';`).trim(), 't');
    assert.throws(() => sql(apply()), /round changed/);
    const afterAdmission = snapshot();
    sql(`INSERT INTO fixture_warnings(round_id,team_id,active) VALUES('${id(20)}','${id(3)}',true);`);
    const booked = [
      { home_team_id: id(3), away_team_id: id(5), ht_match_id: 456, match_type: 4,
        scheduled_for: '2030-03-19T18:25:00Z', schedule_resolution: 'pending' },
      proposal[1],
    ];
    assert.match(sql(apply(afterAdmission, [id(40)], [], booked)), /"fixtures_replaced": 2/);
    assert.equal(sql('SELECT count(*) FROM matches WHERE ht_match_id=456 AND status=\'arranged\';').trim(), '1');
    assert.equal(sql('SELECT actual_ht_home_team_id::text||\':\'||actual_ht_away_team_id::text FROM matches WHERE ht_match_id=456;').trim(), '3:5');
    assert.equal(sql('SELECT count(*) FROM fixture_warnings WHERE active=true;').trim(), '0');
    const afterBooking = snapshot();
    sql(`UPDATE rounds SET reserved_slot_date='2020-11-04T18:25:00Z' WHERE id='${id(20)}';`);
    assert.throws(() => sql(apply(afterBooking, afterBooking.ids, [], [])), /closed after Monday 23:59/);
    assert.deepEqual(snapshot(), afterBooking);
  });
