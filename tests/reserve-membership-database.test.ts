import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const socket = process.env.HT120_TEST_POSTGRES_SOCKET;
const enabled = Boolean(socket?.startsWith('/private/tmp/ht120-calendar-pg.') || socket?.startsWith('/tmp/ht120-calendar-pg.'));
const args = ['-h', socket!, '-p', '55442', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = (input: string) => execFileSync('psql', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const sqlAsync = (input: string) => new Promise<void>((resolve, reject) => {
  const child = spawn('psql', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let error = '';
  child.stderr.on('data', chunk => { error += String(chunk); });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
  child.stdin.end(input);
});
const migration = (name: string) => sql(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
const id = (n: number) => `70000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const json = (data: unknown) => `'${JSON.stringify(data).replaceAll("'", "''")}'::jsonb`;
const write = (statement: string) => sql(`BEGIN; SET LOCAL ht120.membership_write='true'; ${statement} COMMIT;`);
const change = (team: number, action: string, ready: boolean | null = null, override = false) =>
  `SELECT change_tournament_team_membership('${id(10)}','${id(team)}','${action}',${ready ?? 'NULL'},${override});`;
const state = (team = 3) => sql(`SELECT active,reserve_active,actively_waiting,pending_entry_round_id IS NULL FROM teams WHERE id='${id(team)}';`);
const plan = () => JSON.parse(sql(`SELECT get_waiting_admission_plan('${id(10)}',1,true);`)) as { teamIds: string[]; activeTeamIds: string[]; departingTeamIds: string[]; rosterVersion: string; rejected: Array<{ teamId: string; reason: string }> };
const transition = (p = plan()) => {
  const participants = [...p.activeTeamIds.filter(id => !p.departingTeamIds.includes(id)), ...p.teamIds];
  const matches = Array.from({ length: Math.ceil(participants.length / 2) }, (_, index) => ({
    home_team_id: participants[index * 2], away_team_id: participants[index * 2 + 1] || null, scheduled_for: '2030-03-19T18:25:00Z',
  }));
  const array = (values: string[]) => `ARRAY[${values.map(value => `'${value}'::uuid`).join(',')}]::uuid[]`;
  return `SELECT apply_length_round_transition_with_membership('${id(10)}',1,'${id(20)}','${id(21)}',${json(matches)},${array(p.teamIds)},${array(p.activeTeamIds)},'${p.rosterVersion}',NULL);`;
};

function setup(oldPending = false) {
  sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  sql(readFileSync(new URL('./fixtures/calendar-schedule-schema.sql', import.meta.url), 'utf8'));
  sql(`ALTER TABLE tournaments ADD name text, ADD max_teams integer, ADD is_test boolean, ADD is_archived boolean,
    ADD registration_type text, ADD country_limit text, ADD country_limit_format text,
    ADD max_country_active_teams integer, ADD allow_manager_country_size_exception boolean, ADD allow_reserve_registration boolean;
    ALTER TABLE teams ALTER id SET DEFAULT gen_random_uuid(), ADD ht_team_name text, ADD country_id bigint,
    ADD country_name text, ADD league_id integer, ADD gender_id integer, ADD league_level integer,
    ADD power_global_rank integer, ADD power_league_rank integer, ADD power_region_rank integer, ADD join_story jsonb,
    ADD oauth_token text, ADD oauth_token_secret text, ADD joined_via_oauth boolean, ADD reserve_joined_at timestamptz,
    ADD reapply_season_number integer, ADD replacement_for_team_id uuid;
    ALTER TABLE tournament_seasons ADD snapshot_json jsonb, ADD fixtures_snapshot_json jsonb;
    ALTER TABLE tournament_season_slots ADD updated_at timestamptz;
    ALTER TABLE tournament_season_slot_assignments ADD assigned_at timestamptz DEFAULT now(),
      ADD FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE SET NULL;
    ALTER TABLE matches ADD reserve_team_id uuid REFERENCES teams(id), ADD reserve_replaces_team_id uuid,
      ADD finished_at timestamptz, ADD went_120 boolean DEFAULT false, ADD home_goals integer, ADD away_goals integer, ADD match_event_details jsonb,
      ADD FOREIGN KEY(home_team_id) REFERENCES teams(id), ADD FOREIGN KEY(away_team_id) REFERENCES teams(id);
    CREATE TABLE fixture_warnings(team_id uuid,tournament_id uuid,round_id uuid,active boolean);
    CREATE TABLE profiles(hattrick_user_id bigint,teams_json jsonb);
    CREATE FUNCTION country_size_snapshot_count(bigint) RETURNS integer LANGUAGE sql AS 'SELECT 10';
    CREATE FUNCTION tournament_is_exclusive(text,boolean,text) RETURNS boolean LANGUAGE sql
      AS $$ SELECT $1='active' AND NOT COALESCE($2,false) AND $3 IS DISTINCT FROM 'sandbox' $$;`);
  const oldSlots = readFileSync(new URL('../migrations/history/082_reset_season_and_vacate_slot.sql', import.meta.url), 'utf8');
  sql(oldSlots.slice(oldSlots.indexOf('CREATE OR REPLACE FUNCTION public.vacate_team_slot'), oldSlots.indexOf('CREATE OR REPLACE FUNCTION public.fill_vacant_team_slot')));
  const swaps = readFileSync(new URL('../migrations/history/20261001134036_atomic_reserve_slot_swap.sql', import.meta.url), 'utf8');
  sql(swaps.slice(swaps.indexOf('CREATE OR REPLACE FUNCTION public.swap_current'), swaps.indexOf('REVOKE ALL ON FUNCTION public.swap_current')));
  migration('120_restore_same_team_to_vacant_slot.sql');
  const past = readFileSync(new URL('../migrations/126_past_team_admin_actions.sql', import.meta.url), 'utf8');
  sql(past.slice(past.indexOf('CREATE FUNCTION public.fill_past'), past.indexOf('-- Do not let ON DELETE')));
  const lifecycle = readFileSync(new URL('../migrations/113_tournament_planning_and_recruiting.sql', import.meta.url), 'utf8');
  sql(lifecycle.slice(lifecycle.indexOf('CREATE OR REPLACE FUNCTION public.reset_current'), lifecycle.indexOf('CREATE FUNCTION public.transition_tournament_publication')));
  migration('107_calendar_first_generated_schedules.sql');
  migration('108_validated_reserve_admission.sql');
  migration('125_deferred_team_departures.sql');
  migration('134_next_round_manager_join.sql');
  migration('135_allow_unused_past_team_removal_with_released_assignment.sql');
  migration('136_track_reserve_origin.sql');
  sql(`INSERT INTO tournaments(id,status,schedule_mode,schedule_generated_at,max_teams,league_category)
      VALUES('${id(10)}','active','length',now(),NULL,'male');
    INSERT INTO tournament_seasons(id,tournament_id,season_number,status) VALUES('${id(11)}','${id(10)}',1,'ongoing');
    INSERT INTO rounds(id,tournament_id,season_number,round_number,phase,phase_status,reserved_slot_date,reserved_slot_kind)
      VALUES('${id(20)}','${id(10)}',1,1,'regular','materialized','2030-03-12T18:25:00Z','midweek_friendly'),
        ('${id(21)}','${id(10)}',1,2,'regular','pending','2030-03-19T18:25:00Z','midweek_friendly');
    INSERT INTO teams(id,tournament_id,name,ht_team_id,hattrick_user_id,active,reserve_active,
      league_id,country_id,oauth_token,oauth_token_secret,joined_via_oauth,reserve_joined_at)
      VALUES('${id(1)}','${id(10)}','Participant 1',1,100,true,false,1,1,'test-token','test-secret',true,NULL),
        ('${id(2)}','${id(10)}','Participant 2',2,200,true,false,1,1,'test-token','test-secret',true,NULL),
        ('${id(3)}','${id(10)}','Old reserve',3,100,false,true,1,1,'test-token','test-secret',true,now());
    INSERT INTO tournament_season_slots(id,tournament_season_id,slot_index,box_size,current_team_id)
      VALUES('${id(31)}','${id(11)}',1,2,'${id(1)}'),('${id(32)}','${id(11)}',2,2,'${id(2)}');
    INSERT INTO tournament_season_slot_assignments(tournament_season_slot_id,team_id,reason)
      VALUES('${id(31)}','${id(1)}','schedule_backfill'),('${id(32)}','${id(2)}','schedule_backfill');
    INSERT INTO matches(id,round_id,home_team_id,away_team_id,status,completed,schedule_resolution)
      VALUES('${id(40)}','${id(20)}','${id(1)}','${id(2)}','finished',true,'played');`);
  if (oldPending) sql(`BEGIN; SET LOCAL ht120.pending_join_write='true';
    UPDATE teams SET reserve_active=false,pending_entry_round_id='${id(21)}' WHERE id='${id(3)}'; COMMIT;`);
  const membership = readFileSync(new URL('../migrations/128_site_admin_team_limit_override.sql', import.meta.url), 'utf8');
  sql(membership.slice(membership.indexOf('CREATE OR REPLACE FUNCTION public.enforce'), membership.indexOf('CREATE FUNCTION public.promote'))
    .replace('IF public.tournament_is_exclusive(target.status,target.is_test,target.registration_type) THEN',
      "IF public.tournament_is_exclusive(target.status,target.is_test,target.registration_type) AND current_setting('ht120.membership_bypass',true) IS DISTINCT FROM 'true' THEN"));
  sql(`CREATE TRIGGER enforce_tournament_membership BEFORE INSERT OR UPDATE OF active,reserve_active,ht_team_id,tournament_id
    ON public.teams FOR EACH ROW EXECUTE FUNCTION enforce_tournament_membership();`);
  const allowance = readFileSync(new URL('../migrations/121_limit_country_size_manager_allowance.sql', import.meta.url), 'utf8');
  sql(allowance.slice(allowance.indexOf('CREATE FUNCTION public.enforce_country_size_allowance'), allowance.indexOf('COMMIT;')));
  migration('137_reserve_waiting_and_past_actions.sql');
  migration('148_tournament_lobby.sql');
  migration('149_organizer_regular_rounds.sql');
}

test('phase 1 membership over applied 134, 135 and 136', { skip: !enabled }, async (t) => {
  await t.test('old reserve and pending representations normalize to unchecked Waiting', () => {
    setup(); assert.equal(state(), 'f|t|f|t');
    setup(true); assert.equal(state(), 'f|t|f|t');
    assert.equal(sql('SELECT count(*) FROM matches;'), '1');
    assert.equal(sql(`SELECT count(*) FROM pg_trigger WHERE tgname='set_team_reserve_origin';`), '0');
  });
  await t.test('new verified registration is checked Waiting and another owned participant is allowed', () => {
    setup();
    const values = { ht_team_id: 3, name: 'Waiting', hattrick_user_id: 100, league_id: 1, country_id: 1,
      oauth_token: 'fresh-token', oauth_token_secret: 'test-secret' };
    sql(`SELECT request_next_round_tournament_join('${id(10)}',${json(values)});`);
    assert.equal(state(), 'f|t|t|t');
    assert.equal(sql('SELECT count(*) FROM teams;'), '3');
    assert.equal(sql('SELECT count(*) FROM tournament_season_slots;'), '2');
    sql(`UPDATE tournaments SET registration_closed_at=now();`);
    assert.throws(() => sql(`SELECT request_next_round_tournament_join('${id(10)}',${json(values)});`), /registration is closed/);
    sql(transition());
    assert.equal(state(), 't|f|f|t');
    assert.equal(sql(`SELECT count(*) FROM matches WHERE round_id='${id(21)}' AND home_team_id='${id(3)}';`), '1');
  });
  await t.test('a stale join after the last regular cutoff does not create or mark a joined team', () => {
    setup(); sql(`UPDATE rounds SET phase='postseason' WHERE id='${id(21)}';`);
    const values = { ht_team_id: 9, name: 'Too late', hattrick_user_id: 900, league_id: 1, country_id: 1,
      oauth_token: 'synthetic-token', oauth_token_secret: 'synthetic-secret' };
    assert.throws(() => sql(`SELECT request_next_round_tournament_join('${id(10)}',${json(values)});`), /no next regular round/);
    assert.equal(sql('SELECT count(*) FROM teams;'), '3'); assert.equal(state(3), 'f|t|f|t');
  });
  await t.test('unchecked Waiting stays Waiting; Remove is soft and Return is checked', () => {
    setup(); sql(change(3, 'ready', true)); sql(change(3, 'ready', false));
    assert.equal(state(), 'f|t|f|t');
    sql(change(3, 'remove')); assert.equal(state(), 'f|f|f|t');
    sql(change(3, 'return')); assert.equal(state(), 'f|t|t|t');
    sql(`SELECT withdraw_next_round_tournament_join('${id(10)}','${id(3)}',100);`);
    assert.equal(state(), 'f|f|f|t');
    assert.equal(sql('SELECT count(*) FROM teams;'), '3');
  });
  await t.test('manual promotion integrates normally; demotion releases assignment and is unchecked', () => {
    setup(); const before = sql(`SELECT to_jsonb(m) FROM matches m WHERE id='${id(40)}';`);
    sql(change(3, 'promote')); sql(change(3, 'promote')); assert.equal(state(), 't|f|f|t');
    assert.equal(sql('SELECT count(*) FROM tournament_season_slots;'), '4');
    assert.equal(sql(`SELECT count(*) FROM tournament_season_slot_assignments WHERE team_id='${id(3)}' AND released_at IS NULL;`), '1');
    sql(change(3, 'to_waiting')); assert.equal(state(), 'f|t|f|t');
    assert.equal(sql(`SELECT count(*) FROM tournament_season_slot_assignments WHERE team_id='${id(3)}' AND released_at IS NULL;`), '0');
    assert.equal(sql(`SELECT to_jsonb(m) FROM matches m WHERE id='${id(40)}';`), before);
  });
  await t.test('a place opening automatically admits checked Waiting only', () => {
    setup(); sql('UPDATE tournaments SET max_teams=2;'); sql(change(3, 'ready', true));
    assert.equal(plan().teamIds.length, 0);
    sql(change(2, 'remove'));
    assert.equal(state(), 't|f|f|t');
    assert.equal(state(2), 'f|f|f|t');
  });
  await t.test('Leave after round frees capacity before next pairings and keeps completed history', () => {
    setup(); sql('UPDATE tournaments SET max_teams=2;'); sql(change(3, 'ready', true));
    sql(`SELECT set_tournament_team_departure('${id(10)}','${id(1)}',100,true);`);
    const before = sql(`SELECT to_jsonb(m) FROM matches m WHERE id='${id(40)}';`);
    const p = plan(); assert.deepEqual(p.departingTeamIds, [id(1)]); assert.deepEqual(p.teamIds, [id(3)]);
    sql(transition(p)); assert.equal(state(1), 'f|f|f|t'); assert.equal(state(3), 't|f|f|t');
    assert.equal(sql(`SELECT to_jsonb(m) FROM matches m WHERE id='${id(40)}';`), before);
    assert.equal(sql(`SELECT count(*) FROM matches WHERE round_id='${id(21)}' AND '${id(1)}' IN(home_team_id,away_team_id);`), '0');
    assert.equal(sql(`SELECT count(*) FROM matches WHERE round_id='${id(21)}' AND '${id(3)}' IN(home_team_id,away_team_id);`), '1');
  });
  await t.test('one invalid entrant cannot block the round or cause stale pairings', () => {
    setup(); sql(change(3, 'ready', true)); sql(`UPDATE teams SET league_id=3000 WHERE id='${id(3)}';`);
    const p = plan(); assert.equal(p.teamIds.length, 0); assert.match(p.rejected[0]!.reason, /category/);
    sql(transition(p)); assert.equal(state(), 'f|t|t|t');
    assert.equal(sql(`SELECT phase_status FROM rounds WHERE id='${id(21)}';`), 'materialized');
    assert.equal(sql(`SELECT count(*) FROM matches WHERE round_id='${id(21)}' AND (home_team_id='${id(3)}' OR away_team_id='${id(3)}');`), '0');
  });
  await t.test('released assignment history allows return; 135 hard delete remains separate and guarded', () => {
    setup(); sql(change(3, 'remove'));
    sql(`INSERT INTO tournament_season_slot_assignments(tournament_season_slot_id,team_id,released_at,reason)
      VALUES('${id(31)}','${id(3)}',now(),'admin_replace');`);
    sql(change(3, 'return')); assert.equal(plan().teamIds[0], id(3));
    sql(transition()); assert.equal(state(), 't|f|f|t');
    assert.equal(sql(`SELECT count(*) FROM tournament_season_slot_assignments WHERE team_id='${id(3)}';`), '2');
    assert.throws(() => sql(`SELECT remove_unused_past_tournament_team('${id(10)}','${id(3)}');`), /Only unused Past/);
  });
  await t.test('booked fixtures and live assignments remain protected even for overrides', () => {
    setup(); sql(`UPDATE matches SET completed=false,status='arranged',ht_match_id=99,scheduled_for='2030-03-12' WHERE id='${id(40)}';`);
    const before = sql('SELECT jsonb_agg(to_jsonb(m)) FROM matches m;');
    assert.throws(() => sql(change(1, 'to_waiting', null, true)), /booked or started/);
    assert.equal(state(1), 't|f|f|t');
    assert.equal(sql('SELECT jsonb_agg(to_jsonb(m)) FROM matches m;'), before);
  });
  await t.test('finalized unplayed history allows return; unresolved partial results block departure', () => {
    setup(); sql(`INSERT INTO matches(round_id,home_team_id,away_team_id,completed,status,schedule_resolution,scheduled_for)
      VALUES('${id(20)}','${id(3)}','${id(2)}',false,'misarranged','finalized_unplayed','2020-01-01');`);
    sql(change(3, 'remove')); sql(change(3, 'return'));
    assert.deepEqual(plan().teamIds, [id(3)]); sql(transition()); assert.equal(state(3), 't|f|f|t');
    setup(); sql(`UPDATE matches SET completed=false,status='not_arranged',home_goals=1,scheduled_for='2030-03-12' WHERE id='${id(40)}';`);
    assert.throws(() => sql(change(1,'remove',null,true)), /partial result/); assert.equal(state(1),'t|f|f|t');
  });
  await t.test('ordinary eligibility and capacity checks hold; override remains explicit', () => {
    setup(); sql('UPDATE tournaments SET max_teams=2;');
    assert.throws(() => sql(change(3, 'promote')), /team limit/);
    sql(`UPDATE teams SET league_id=3000 WHERE id='${id(3)}';`);
    assert.throws(() => sql(change(3, 'promote')), /category/);
    sql(change(3, 'promote', null, true)); assert.equal(state(), 't|f|f|t');
  });
  await t.test('simultaneous normal admissions serialize capacity without a partial slot or duplicate assignment', async () => {
    setup(); sql('UPDATE tournaments SET max_teams=3;');
    write(`INSERT INTO teams(id,tournament_id,name,ht_team_id,hattrick_user_id,active,reserve_active,league_id,country_id,joined_via_oauth,oauth_token,oauth_token_secret)
      VALUES('${id(4)}','${id(10)}','Another Waiting team',4,400,false,true,1,1,true,'synthetic-token','synthetic-secret');`);
    const attempts = await Promise.allSettled([3,4].map(team => sqlAsync(`SELECT activate_waiting_team('${id(10)}','${id(team)}');`)));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = attempts.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(rejected.reason), /team limit/);
    assert.equal(sql('SELECT count(*) FROM teams WHERE active AND NOT reserve_active;'), '3');
    assert.equal(sql('SELECT count(*) FROM tournament_season_slots;'), '4');
    assert.equal(sql(`SELECT count(*) FROM tournament_season_slot_assignments WHERE team_id IN('${id(3)}','${id(4)}') AND released_at IS NULL;`), '1');
  });
  await t.test('stale admission sets or snapshots roll back and request replanning', () => {
    setup(); sql(change(3, 'ready', true)); const p = plan();
    sql(change(3, 'ready', false));
    assert.throws(() => sql(transition(p)), /membership changed/);
    assert.equal(sql('SELECT count(*) FROM tournament_season_slots;'), '2');
    assert.equal(sql(`SELECT phase_status FROM rounds WHERE id='${id(20)}';`), 'materialized');
  });
  await t.test('write guards and service-only RPC grants cover the new checkbox', () => {
    setup();
    assert.throws(() => sql(`UPDATE teams SET actively_waiting=true WHERE id='${id(3)}';`), /authorized service route/);
    sql('GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;');
    for (const role of ['anon','authenticated']) assert.throws(() => sql(`SET ROLE ${role}; ${change(3,'promote')}`), /permission denied/);
    sql(`SET ROLE service_role; ${change(3,'ready',true)}`); assert.equal(state(), 'f|t|t|t');
  });
  await t.test('fixed-format replacement clears readiness while preserving the original fixture/history rules', () => {
    setup(); sql(`UPDATE tournaments SET schedule_mode='single';`); sql(change(3, 'ready', true));
    const before = sql(`SELECT to_jsonb(m) FROM matches m WHERE id='${id(40)}';`);
    sql(`SELECT * FROM swap_current_season_team_with_reserve('${id(10)}',1,'${id(1)}','${id(3)}');`);
    assert.equal(state(1), 'f|t|f|t'); assert.equal(state(3), 't|f|f|t');
    assert.equal(sql(`SELECT to_jsonb(m) FROM matches m WHERE id='${id(40)}';`), before);
    assert.equal(sql(`SELECT current_team_id FROM tournament_season_slots WHERE id='${id(31)}';`), id(3));
  });
  await t.test('136 reserve registration exception is closed while accepted Waiting remains admissible', () => {
    setup(); sql(change(3, 'ready',true)); sql('UPDATE tournaments SET registration_closed_at=now();');
    const values={ tournament_id:id(10),ht_team_id:9,name:'New',active:false,reserve_active:true };
    assert.throws(() => sql(`SELECT save_verified_tournament_registration(${json(values)},NULL,false);`), /registration is closed/);
    sql(transition()); assert.equal(state(), 't|f|f|t');
  });
});


test('Lobby and explicit organizer rounds', { skip: !enabled }, async (t) => {
  const context = () => JSON.parse(sql(`SELECT get_organizer_round_context('${id(10)}',1);`)) as { rosterVersion: string };
  const slot = { id: 'S95-W15-weekend', kind: 'weekend_friendly', date: '2030-03-23T12:00:00Z' };
  const roster = [{ teamId: id(1), participation: 'round_only' }, { teamId: id(3), participation: 'round_only' }];
  const matches = [{ home_team_id: id(1), away_team_id: id(3), scheduled_for: '2030-03-23T12:00:00Z' }];
  const save = (version = context().rosterVersion, field = roster, fixtures = matches) =>
    `SELECT create_organizer_regular_round('${id(10)}',1,'${version}',${json(slot)},${json(field)},${json(fixtures)},false);`;
  await t.test('exclusive statuses synchronize legacy automatic admission and reject other managers', () => {
    setup();
    assert.equal(sql(`SELECT lobby_status FROM teams WHERE id='${id(3)}';`), 'hanging_around');
    sql(`SELECT change_tournament_lobby_status('${id(10)}','${id(3)}','open_to_invitations',100);`);
    assert.equal(sql(`SELECT lobby_status,actively_waiting FROM teams WHERE id='${id(3)}';`), 'open_to_invitations|f');
    assert.throws(() => sql(`SELECT change_tournament_lobby_status('${id(10)}','${id(3)}','ready_to_join',999);`), /another manager/);
    sql(`SELECT change_tournament_lobby_status('${id(10)}','${id(3)}','ready_to_join',100);`);
    assert.equal(sql(`SELECT lobby_status,actively_waiting FROM teams WHERE id='${id(3)}';`), 'ready_to_join|t');
    assert.throws(() => sql(`UPDATE teams SET lobby_status='hanging_around' WHERE id='${id(3)}';`), /authorized service route/);
    sql(change(3,'ready',false));
    assert.equal(sql(`SELECT lobby_status FROM teams WHERE id='${id(3)}';`),'hanging_around');
  });
  await t.test('round-only participation preserves membership, fixtures, and reserved pairings', () => {
    setup(); const before = state();
    const result = JSON.parse(sql(save())) as { roundId: string };
    assert.equal(state(), before);
    assert.equal(sql(`SELECT count(*) FROM round_participants WHERE round_id='${result.roundId}';`),'2');
    assert.equal(sql(`SELECT schedule_slot_type FROM matches WHERE round_id='${result.roundId}';`),'weekend_friendly');
    assert.equal(sql(`SELECT count(*) FROM matches WHERE id='${id(40)}';`),'1');
    assert.equal(sql(`SELECT phase_status FROM rounds WHERE id='${id(21)}';`),'pending');
  });
  await t.test('stale, duplicate and invalid roster saves leave no partial effects', () => {
    setup(); const stale = context().rosterVersion;
    sql(change(3,'ready',true));
    assert.throws(() => sql(save(stale)), /changed/);
    assert.equal(sql(`SELECT count(*) FROM rounds WHERE round_source='organizer';`),'0');
    assert.throws(() => sql(save(context().rosterVersion, roster, [{ ...matches[0], away_team_id: id(1) }])), /exactly once/);
    sql(save());
    assert.throws(() => sql(save()), /already has a round/);
    assert.equal(sql('SELECT count(*) FROM round_participants;'),'2');
  });
  await t.test('admission is atomic with round save and existing authorization grants stay closed', () => {
    setup();
    sql(save(context().rosterVersion,[roster[0],{teamId:id(3),participation:'admit'}]));
    assert.equal(state(),'t|f|f|t');
    assert.equal(sql(`SELECT has_function_privilege('anon','public.create_organizer_regular_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean)','EXECUTE');`),'f');
    assert.equal(sql(`SELECT has_table_privilege('anon','public.round_participants','INSERT');`),'f');
  });
  await t.test('failed continuing admission rolls back the entire roster and concurrent saves create one round', async () => {
    setup(); sql('UPDATE tournaments SET max_teams=2;');
    assert.throws(() => sql(save(context().rosterVersion,[roster[0],{teamId:id(3),participation:'admit'}])), /limit/);
    assert.equal(state(),'f|t|f|t');
    assert.equal(sql("SELECT count(*) FROM rounds WHERE round_source='organizer';"),'0');
    const statement = save();
    const results = await Promise.allSettled([sqlAsync(statement), sqlAsync(statement)]);
    assert.equal(results.filter(result => result.status==='fulfilled').length,1);
    assert.equal(sql("SELECT count(*) FROM rounds WHERE round_source='organizer';"),'1');
    assert.equal(sql('SELECT count(*) FROM round_participants;'),'2');
  });
  await t.test('unresolved added rounds block qualification but can complete independently', () => {
    setup();
    const result = JSON.parse(sql(save())) as { roundId:string };
    sql(`UPDATE rounds SET phase='postseason' WHERE id='${id(21)}';`);
    const blocked = JSON.parse(sql(`SELECT apply_length_round_transition('${id(10)}',1,'${id(20)}','${id(21)}','[]',NULL);`));
    assert.equal(blocked.reason,'additional_regular_round_unresolved');
    assert.equal(sql(`SELECT phase_status FROM rounds WHERE id='${id(20)}';`),'materialized');
    sql(`UPDATE matches SET completed=true,status='finished' WHERE round_id='${result.roundId}';`);
    sql(`SELECT apply_length_round_transition('${id(10)}',1,'${result.roundId}',NULL,'[]',NULL);`);
    assert.equal(sql(`SELECT phase_status FROM rounds WHERE id='${result.roundId}';`),'completed');
    assert.equal(state(),'f|t|f|t');
  });
});
