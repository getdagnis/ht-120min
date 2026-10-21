import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import test from 'node:test';

// Explicit opt-in, restricted to a disposable socket. Never use an application DB.
const socket = process.env.HT120_RATINGS_TEST_POSTGRES_SOCKET;
const enabled = Boolean(socket?.startsWith('/private/tmp/ht120-ratings-pg.') || socket?.startsWith('/tmp/ht120-ratings-pg.'));
const args = ['-h', socket || '', '-p', '55443', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'];
const sql = (input: string) => execFileSync('psql', args, { input, encoding: 'utf8' }).trim();
const concurrentSql = (input: string) => new Promise<string>((resolve, reject) => {
  const child = execFile('psql', args, { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  child.stdin!.end(input);
});
const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const cup = id(10), fixture = id(40), home = id(1), away = id(2);
const values = JSON.stringify({ left_attack: 1, centre_attack: 2, right_attack: 3, midfield: 4,
  left_defence: 5, centre_defence: 6, right_defence: 7, formation: '4-5-1', tactic: 'Normal',
  fetched_at: '2030-01-01T00:00:00Z', specialty_positions: [],
  fixture_context: { home_team_id: home, away_team_id: away, home_ht_team_id: 11, away_ht_team_id: 22 } });
const action = (name: string, team = home, manager = 7, match = 123, claim: string | null = null, existing: string | null = null) =>
  `SELECT fixture_rating_sharing_action('${fixture}','${team}',${manager},${match},'${name}',${claim ? `'${claim}'` : 'NULL'},'${values}'::jsonb,${existing ? `'${existing}'` : 'NULL'});`;
const toggle = (on: boolean) => `SELECT set_team_rating_sharing('${cup}','${home}',7,${on});`;
const claimId = () => JSON.parse(sql(action('claim')) || 'null')?.claim_id as string | undefined;

test('rating sharing SQL preserves manual rows, serializes claims, and protects opt-out, Remove and fixture boundaries', { skip: !enabled }, async () => {
  sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  sql(readFileSync(new URL('./fixtures/calendar-schedule-schema.sql', import.meta.url), 'utf8'));
  sql('GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;');
  sql('ALTER TABLE tournaments ADD is_archived boolean DEFAULT false;');
  sql(readFileSync(new URL('../migrations/095_fixture_predicted_rating_shares.sql', import.meta.url), 'utf8'));
  sql(readFileSync(new URL('../migrations/096_limit_fixture_rating_visibility.sql', import.meta.url), 'utf8'));
  sql(readFileSync(new URL('../migrations/101_add_confirmed_chpp_match_dates.sql', import.meta.url), 'utf8'));
  sql(readFileSync(new URL('../migrations/103_fixture_player_specialty_positions.sql', import.meta.url), 'utf8'));
  sql(readFileSync(new URL('../migrations/104_add_fixture_rating_coach_modifier.sql', import.meta.url), 'utf8'));
  sql(`INSERT INTO tournaments(id,season,status) VALUES('${cup}',1,'active');
    INSERT INTO rounds(id,tournament_id,season_number) VALUES('${id(20)}','${cup}',1);
    INSERT INTO teams(id,tournament_id,ht_team_id,hattrick_user_id) VALUES('${home}','${cup}',11,7),('${away}','${cup}',22,8);
    INSERT INTO matches(id,round_id,home_team_id,away_team_id,ht_match_id,status,scheduled_for)
      VALUES('${fixture}','${id(20)}','${home}','${away}',123,'arranged',now()+interval '1 day');
    INSERT INTO fixture_predicted_rating_shares(fixture_id,team_id,ht_match_id,left_attack,centre_attack,right_attack,midfield,
      left_defence,centre_defence,right_defence,formation,tactic,fetched_at)
      VALUES('${fixture}','${away}',123,1,1,1,1,1,1,1,'4-5-1','Normal',now());`);
  sql(readFileSync(new URL('../migrations/118_automatic_fixture_rating_sharing.sql', import.meta.url), 'utf8'));
  sql(readFileSync(new URL('../migrations/119_fixture_order_status.sql', import.meta.url), 'utf8'));
  assert.equal(sql(`SELECT share_source FROM fixture_predicted_rating_shares WHERE team_id='${away}';`), 'manual');
  const claims = await Promise.all([concurrentSql(action('claim')), concurrentSql(action('claim'))]);
  assert.equal(claims.filter(Boolean).length, 1, 'only one refresh may fetch predictions');
  const token = JSON.parse(claims.find(Boolean)!).claim_id;
  assert.match(sql(action('automatic', home, 7, 123, token)), /saved.*true/);
  const automaticRowId = sql(`SELECT id FROM fixture_predicted_rating_shares WHERE team_id='${home}';`);
  sql(action('update', home, 7, 123, null, automaticRowId));
  assert.equal(sql(`SELECT share_source FROM fixture_predicted_rating_shares WHERE team_id='${home}';`), 'automatic');
  assert.equal(sql(action('claim')), '', 'a shared prediction is never refreshed in background');
  sql(toggle(false));
  assert.throws(() => sql(action('update', home, 7, 123, null, automaticRowId)), /removed while ratings were loading/);
  assert.equal(sql(`SELECT count(*) FROM fixture_predicted_rating_shares;`), '1');
  assert.equal(sql(action('claim')), '');
  sql(toggle(true));
  const pending = claimId()!;
  sql(toggle(false)); sql(toggle(true));
  assert.equal(sql(action('automatic', home, 7, 123, pending)), '', 'off/on invalidates in-flight work');
  const removePending = claimId()!;
  sql(action('remove'));
  assert.equal(sql(action('automatic', home, 7, 123, removePending)), '');
  assert.equal(sql(action('claim')), '', 'Remove suppresses this match');
  sql(toggle(false)); sql(toggle(true));
  assert.equal(sql(action('claim')), '', 're-enabling does not clear an individual Remove');
  sql(action('share'));
  assert.equal(sql(`SELECT suppressed FROM fixture_rating_automation WHERE team_id='${home}';`), 'f');
  sql(toggle(false));
  assert.equal(sql(`SELECT count(*) FROM fixture_predicted_rating_shares;`), '2', 'explicit shares survive switching off');
  const rowId = sql(`SELECT id FROM fixture_predicted_rating_shares WHERE team_id='${home}';`);
  sql(action('remove'));
  assert.throws(() => sql(action('update', home, 7, 123, null, rowId)), /removed while ratings were loading/);
  sql(toggle(true));
  sql('UPDATE matches SET ht_match_id=124;');
  const newMatchToken = JSON.parse(sql(action('claim', home, 7, 124))).claim_id;
  sql(`INSERT INTO teams(id,tournament_id,ht_team_id,hattrick_user_id) VALUES('${id(3)}','${cup}',33,7);
    UPDATE matches SET away_team_id='${id(3)}';`);
  assert.equal(sql(action('automatic', home, 7, 124, newMatchToken)), '', 'a changed opponent rejects publication');
  sql(`UPDATE matches SET away_team_id='${away}'; UPDATE teams SET ht_team_id=44 WHERE id='${home}';`);
  assert.equal(sql(action('automatic', home, 7, 124, newMatchToken)), '', 'a changed club identity rejects publication');
  sql(`UPDATE teams SET ht_team_id=11 WHERE id='${home}';`);
  assert.equal(sql(action('claim', home, 7, 123)), '', 'a replaced match is rejected');
  sql('UPDATE matches SET scheduled_for=now()-interval \'1 second\';');
  assert.equal(sql(action('automatic', home, 7, 124, newMatchToken)), '', 'kickoff rejects publication');
  sql('UPDATE matches SET scheduled_for=now()+interval \'1 day\'; UPDATE tournaments SET season=2;');
  assert.equal(sql(action('claim', home, 7, 124)), '', 'past seasons are rejected');
  sql('UPDATE rounds SET season_number=2;');
  assert.equal(sql(`SELECT enabled FROM tournament_team_rating_preferences WHERE team_id='${home}';`), 't');
  assert.throws(() => sql(action('claim', home, 8, 124)), /do not manage/);
  assert.throws(() => sql(`SET ROLE authenticated; ${toggle(false)}`), /permission denied/);
  assert.throws(() => sql('SET ROLE anon; SELECT * FROM fixture_rating_automation;'), /permission denied/);
  assert.throws(() => sql('SET ROLE authenticated; SELECT * FROM tournament_team_rating_preferences;'), /permission denied/);
  assert.throws(() => sql('SET ROLE anon; SELECT * FROM fixture_predicted_rating_shares;'), /permission denied/);
  sql('RESET ROLE;');
  sql('UPDATE tournaments SET season=1; UPDATE rounds SET season_number=1; UPDATE matches SET ht_match_id=123;');
  sql(`UPDATE fixture_rating_automation SET suppressed=false,claim_id=NULL,claim_expires_at=NULL,retry_after=NULL WHERE team_id='${home}';`);
  const retryToken = claimId()!;
  sql(action('release', home, 7, 123, retryToken));
  assert.equal(sql(action('claim')), '', 'failed predictions observe the retry cooldown');
  sql(`UPDATE fixture_rating_automation SET retry_after=now()-interval '1 second' WHERE team_id='${home}';`);
  assert.ok(claimId());
  sql(`UPDATE fixture_rating_automation SET claim_expires_at=now()-interval '1 second' WHERE team_id='${home}';`);
  assert.ok(claimId(), 'expired claims can be retried after a worker stops');
  const statusToken = sql(`SELECT claim_id FROM fixture_rating_automation WHERE team_id='${home}' AND ht_match_id=123;`);
  const recordStatus = (given: string, token = statusToken) => `SELECT record_fixture_order_status('${fixture}','${home}',7,123,'${token}',${given},'${JSON.stringify(JSON.parse(values).fixture_context)}'::jsonb);`;
  assert.equal(sql(recordStatus('false')), 't');
  assert.equal(sql(`SET ROLE anon; SELECT shared||':'||auto_sharing_enabled||':'||orders_given FROM fixture_predicted_rating_share_status WHERE team_id='${home}';`), 'false:true:false');
  sql('RESET ROLE;');
  assert.equal(sql(recordStatus('NULL')), 't');
  assert.equal(sql(`SELECT orders_given IS NULL FROM fixture_predicted_rating_share_status WHERE team_id='${home}';`), 't');
  sql(recordStatus('false'));
  sql(`UPDATE fixture_rating_automation SET orders_checked_at=now()-interval '16 minutes';`);
  assert.equal(sql(`SELECT orders_given IS NULL FROM fixture_predicted_rating_share_status WHERE team_id='${home}';`), 't');
  sql(recordStatus('false'));
  sql(`UPDATE teams SET ht_team_id=44 WHERE id='${home}';`);
  assert.equal(sql(`SELECT orders_given IS NULL FROM fixture_predicted_rating_share_status WHERE team_id='${home}';`), 't');
  assert.equal(sql(recordStatus('false')), 'f', 'changed identities cannot record an old response');
  sql(`UPDATE teams SET ht_team_id=11 WHERE id='${home}';`);
  sql(toggle(false));
  assert.equal(sql(recordStatus('false')), 'f', 'opt-out invalidates pending status writes');
  assert.equal(sql(`SELECT auto_sharing_enabled FROM fixture_predicted_rating_share_status WHERE team_id='${home}';`), 'f');
  assert.throws(() => sql(`SET ROLE authenticated; ${recordStatus('false')}`), /permission denied/);

  sql('RESET ROLE;');
  sql(readFileSync(new URL('../migrations/138_use_confirmed_kickoff_for_fixture_ratings.sql', import.meta.url), 'utf8'));
  sql(`DELETE FROM fixture_predicted_rating_shares; DELETE FROM fixture_rating_automation;
    UPDATE matches SET scheduled_for=now()-interval '1 day', chpp_match_date=now()+interval '1 day';`);
  sql(toggle(true));
  assert.equal(sql(`SET ROLE anon; SELECT count(*) FROM fixture_predicted_rating_share_status WHERE fixture_id='${fixture}';`), '2',
    'confirmed upcoming fixtures stay visible despite an expired estimate');
  sql('RESET ROLE;');
  const confirmedClaim = claimId();
  assert.ok(confirmedClaim, 'automatic sharing claims use the confirmed date');
  assert.match(sql(action('automatic', home, 7, 123, confirmedClaim)), /saved.*true/);
  sql(`DELETE FROM fixture_predicted_rating_shares; DELETE FROM fixture_rating_automation;
    UPDATE matches SET scheduled_for=now()+interval '1 day', chpp_match_date=now()-interval '1 second';`);
  assert.equal(sql(`SELECT count(*) FROM fixture_predicted_rating_share_status WHERE fixture_id='${fixture}';`), '0');
  assert.equal(sql(action('claim')), '', 'a past confirmed kickoff closes sharing despite a future estimate');
  sql(`UPDATE matches SET chpp_match_date=NULL;`);
  assert.equal(sql(action('claim')), '', 'an unconfirmed arranged fixture cannot use its estimate');
  assert.equal(sql(`SELECT count(*) FROM fixture_predicted_rating_share_status WHERE fixture_id='${fixture}';`), '0');
});
