import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import test from 'node:test';
import { getCountryActiveTeamCount } from '../shared/country-active-team-counts';
import { HATTRICK_WORLD_DETAILS } from '../shared/worlddetails';

// Dedicated disposable cluster only; never accept a configured application DB.
const socket = process.env.HT120_COUNTRY_TEST_PG;
const enabled = Boolean(socket?.startsWith('/private/tmp/ht120-country-pg.'));
const args = ['-h', socket!, '-p', '55443', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = (input: string) => execFileSync('psql', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const concurrentSql = (input: string) => new Promise<string>((resolve, reject) => {
  const child = execFile('psql', args, { encoding: 'utf8' }, (error, stdout, stderr) =>
    error ? reject(new Error(stderr)) : resolve(stdout.trim()));
  child.stdin!.end(input);
});

test('country allowance migration: registration, waiting, promotion, grandfathering, bypass and concurrency', { skip: !enabled }, async () => {
  sql(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE tournaments(id integer PRIMARY KEY, max_country_active_teams integer, allow_manager_country_size_exception boolean);
    CREATE TABLE teams(id integer PRIMARY KEY, tournament_id integer, ht_team_id integer, hattrick_user_id integer,
      country_id integer, is_placeholder boolean DEFAULT false, active boolean DEFAULT false,
      reserve_active boolean DEFAULT false, reapply_season_number integer);
    CREATE FUNCTION lock_tournament_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(120,113); RETURN NULL; END $$;
    CREATE TRIGGER serialize_team_membership BEFORE INSERT OR UPDATE OR DELETE ON teams
      FOR EACH STATEMENT EXECUTE FUNCTION lock_tournament_membership();
    INSERT INTO tournaments VALUES(1,420,true),(2,NULL,false),(3,420,false);
    INSERT INTO teams VALUES(90,1,90,900,${HATTRICK_WORLD_DETAILS[54]!.countryId},false,true,false,NULL);`);
  sql(readFileSync(new URL('../migrations/121_limit_country_size_manager_allowance.sql', import.meta.url), 'utf8'));
  for (const league of Object.values(HATTRICK_WORLD_DETAILS)) {
    if (league.countryId == null) continue;
    assert.equal(sql(`SELECT country_size_snapshot_count(${league.countryId});`), String(getCountryActiveTeamCount(league.countryId) ?? ''));
  }
  const small = HATTRICK_WORLD_DETAILS[22]!.countryId!;
  const large = HATTRICK_WORLD_DETAILS[54]!.countryId!;
  const insert = (id: number, manager: number, country: number, waiting = false, tournament = 1) =>
    `INSERT INTO teams(id,tournament_id,ht_team_id,hattrick_user_id,country_id,active,reserve_active)
      VALUES(${id},${tournament},${id},${manager},${country},${!waiting},${waiting});`;
  assert.throws(() => sql(insert(1,123,large)), /allowance changed/);
  sql(insert(1,123,small)); sql(insert(2,123,large));
  assert.throws(() => sql(insert(3,123,large)), /allowance changed/);
  sql(insert(4,456,small,true)); sql(insert(5,456,large,true));
  assert.throws(() => sql(insert(6,456,large,true)), /allowance changed/);
  assert.throws(() => sql('UPDATE teams SET active=true,reserve_active=false WHERE id=5;'), /allowance changed/);
  // Larger first is valid when the qualifying small team is promoted in the same transaction.
  sql('BEGIN; UPDATE teams SET active=true,reserve_active=false WHERE id=5; UPDATE teams SET active=true,reserve_active=false WHERE id=4; COMMIT;');
  sql('UPDATE teams SET active=false WHERE id=1; UPDATE teams SET country_id=999999 WHERE id=2;');
  assert.equal(sql('SELECT active FROM teams WHERE id=2;'), 't');
  assert.throws(() => sql(insert(7,123,large,true)), /allowance changed/);
  sql('UPDATE teams SET country_id=999999 WHERE id=90;');
  sql(insert(8,789,large,false,2));
  assert.throws(() => sql(insert(9,789,large,false,3)), /allowance changed/);
  sql(`BEGIN; SELECT set_config('ht120.membership_bypass','true',true); ${insert(9,789,large)} SELECT set_config('ht120.membership_bypass','false',true); COMMIT;`);
  sql(insert(10,321,small));
  const results = await Promise.allSettled([
    concurrentSql(`BEGIN; ${insert(11,321,large)} SELECT pg_sleep(0.2); COMMIT;`),
    concurrentSql(`BEGIN; ${insert(12,321,large)} COMMIT;`),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(sql('SELECT count(*) FROM teams WHERE hattrick_user_id=321;'), '2');
  sql(insert(13,654,small,true));
  const waitingResults = await Promise.allSettled([
    concurrentSql(insert(14,654,large,true)), concurrentSql(insert(15,654,large,true)),
  ]);
  assert.equal(waitingResults.filter(result => result.status === 'fulfilled').length, 1);
  // Instrument only the disposable trigger body to observe deferred execution.
  sql('ALTER TABLE teams ADD name text, ADD logo_url text, ADD power_rating integer; CREATE TABLE allowance_probe(team_id integer);');
  const triggerBody = sql("SELECT pg_get_functiondef('enforce_country_size_allowance()'::regprocedure);");
  sql(triggerBody.replace('BEGIN', 'BEGIN INSERT INTO public.allowance_probe VALUES(NEW.id);'));
  sql("UPDATE teams SET name='Refreshed',logo_url='new.png',power_rating=1000 WHERE id=10;");
  assert.equal(sql('SELECT count(*) FROM allowance_probe;'), '0', 'unrelated updates never queue allowance checks');
  sql('UPDATE teams SET country_id=country_id WHERE id=10;');
  assert.equal(sql('SELECT count(*) FROM allowance_probe;'), '1', 'country writes retain eligibility checks');

  // Hold the shared lock until both probes finish; avoid timing-dependent sleeps.
  let holder!: ReturnType<typeof execFile>;
  let holderDone!: Promise<string>;
  await new Promise<void>((resolve, reject) => {
    holderDone = new Promise<string>((done, failed) => {
      holder = execFile('psql', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) { reject(new Error(stderr)); failed(new Error(stderr)); }
        else done(stdout);
      });
    });
    holder.stdout!.on('data', chunk => { if (String(chunk).includes('membership_lock_ready')) resolve(); });
    holder.stdin!.write('BEGIN; SELECT pg_advisory_xact_lock(120,113);\n\\echo membership_lock_ready\n');
  });
  try {
    sql("SET lock_timeout='100ms'; UPDATE teams SET logo_url='refresh.png' WHERE id=10;");
    assert.throws(() => sql(`SET lock_timeout='100ms'; UPDATE teams SET country_id=${large} WHERE id=10;`), /lock timeout/,
      'actual country changes still serialize with membership checks');
  } finally {
    holder.stdin!.end('COMMIT;\n');
    await holderDone;
  }
});
