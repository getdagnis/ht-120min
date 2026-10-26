import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// A separate disposable database avoids sharing public with other SQL suites.
// Opt-in is restricted to the project's disposable local socket convention.
const socket = process.env.HT120_TEST_POSTGRES_SOCKET;
const enabled = Boolean(socket?.startsWith('/private/tmp/ht120-calendar-pg.'));
const uuid = (index: number) => `10000000-0000-0000-0000-${String(index).padStart(12, '0')}`;

test('verified organizer saves and repairs are atomic and preserve protected/unchanged fixture identities', { skip: !enabled }, () => {
  const database = `ht120_organizer_${process.pid}`;
  const sql = (input: string, name = database) => execFileSync('psql', ['-h', socket!, '-p', '55442', '-U', 'postgres', '-d', name,
    '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'], { input, encoding: 'utf8' });
  sql(`CREATE DATABASE ${database};`, 'postgres');
  try {
    sql(readFileSync(new URL('./fixtures/calendar-schedule-schema.sql', import.meta.url), 'utf8'));
    sql(readFileSync(new URL('../migrations/107_calendar_first_generated_schedules.sql', import.meta.url), 'utf8'));
    sql(`ALTER TABLE tournaments ADD COLUMN is_archived boolean DEFAULT false;
      ALTER TABLE teams ADD COLUMN lobby_status text DEFAULT 'hanging_around', ADD COLUMN country_name text,
        ADD COLUMN league_level integer, ADD COLUMN country_id integer, ADD COLUMN league_id integer, ADD COLUMN gender_id integer;
      ALTER TABLE matches ADD COLUMN went_120 boolean DEFAULT false, ADD COLUMN finished_at timestamptz,
        ADD COLUMN chpp_match_date timestamptz, ADD COLUMN home_goals integer, ADD COLUMN away_goals integer;
      CREATE TABLE fixture_warnings(id uuid DEFAULT gen_random_uuid(),round_id uuid,team_id uuid,active boolean DEFAULT true);
      CREATE TABLE fixture_predicted_rating_shares(fixture_id uuid REFERENCES matches(id) ON DELETE CASCADE);
      CREATE TABLE profiles(hattrick_user_id bigint PRIMARY KEY, teams_json jsonb);`);
    sql(readFileSync(new URL('../migrations/149_organizer_regular_rounds.sql', import.meta.url), 'utf8'));
    sql(readFileSync(new URL('../migrations/150_organizer_pairing_assistant.sql', import.meta.url), 'utf8'));
    assert.match(sql('SELECT organizer_saved_repair_enabled();'), /f/);
    sql(readFileSync(new URL('../migrations/151_organizer_saved_round_repair.sql', import.meta.url), 'utf8'));
    assert.match(sql('SELECT organizer_saved_repair_enabled();'), /t/);
    sql(`INSERT INTO tournaments(id,season,schedule_mode,schedule_generated_at,status) VALUES('${uuid(100)}',1,'length',now(),'active');
      ${Array.from({ length: 6 }, (_, i) => `INSERT INTO teams(id,tournament_id,name,ht_team_id,hattrick_user_id,active) VALUES('${uuid(i + 1)}','${uuid(100)}','Team ${i + 1}',${i + 1},${i + 1},true);`).join('\n')}`);
    const output = sql(`DO $$
      DECLARE slot jsonb:=jsonb_build_object('id','test-weekend','kind','weekend_friendly','date',now()+interval '7 days');
        roster jsonb; pairs jsonb; repaired jsonb; version text; result jsonb; rid uuid; protected_id uuid; replaced_id uuid; unchanged_id uuid;
        verification uuid:='${uuid(200)}';
      BEGIN
        INSERT INTO profiles VALUES(42,'[{"teamId":1,"teamName":"A"},{"teamId":2,"teamName":"B"}]');
        PERFORM save_team_flag_snapshot(42,1,'{"homeFlagLeagueIds":[],"awayFlagLeagueIds":[],"homeFlagsUnknown":false,"awayFlagsUnknown":true,"flagsFetchedAt":"2026-10-30T00:00:00Z"}');
        PERFORM save_team_flag_snapshot(42,2,'{"homeFlagLeagueIds":[1],"awayFlagLeagueIds":[],"homeFlagsUnknown":false,"awayFlagsUnknown":false,"flagsFetchedAt":"2026-10-30T00:00:00Z"}');
        IF (SELECT teams_json->0->>'awayFlagsUnknown' FROM profiles WHERE hattrick_user_id=42)<>'true'
          OR (SELECT teams_json->1->'homeFlagLeagueIds' FROM profiles WHERE hattrick_user_id=42)<>'[1]'::jsonb THEN
          RAISE EXCEPTION 'flag merge lost another club'; END IF;
        SELECT jsonb_agg(jsonb_build_object('teamId',id,'participation','round_only') ORDER BY ht_team_id) INTO roster FROM teams;
        pairs:=jsonb_build_array(
          jsonb_build_object('home_team_id','${uuid(1)}','away_team_id','${uuid(2)}','scheduled_for',slot->>'date'),
          jsonb_build_object('home_team_id','${uuid(3)}','away_team_id','${uuid(4)}','scheduled_for',slot->>'date'),
          jsonb_build_object('home_team_id','${uuid(5)}','away_team_id','${uuid(6)}','scheduled_for',slot->>'date'));
        INSERT INTO tournament_slot_checks(tournament_id,season_number,slot_id,team_id,checked_at,observation,verification_id,proposal_hash,actor_id)
          SELECT '${uuid(100)}',1,'test-weekend',id,now(),jsonb_build_object('state','free','challengesKnown',true,'pendingOpponentIds','[]'::jsonb),verification,'hash',42 FROM teams;
        version:=get_organizer_round_context('${uuid(100)}',1)->>'rosterVersion';
        result:=save_verified_organizer_round('${uuid(100)}',1,version,slot,roster,pairs,false,NULL,verification,'hash',42);
        rid:=(result->>'roundId')::uuid;
        IF (SELECT count(*) FROM matches WHERE round_id=rid)<>3 THEN RAISE EXCEPTION 'creation coverage'; END IF;
        IF EXISTS(SELECT 1 FROM tournament_slot_checks WHERE verification_id IS NOT NULL) THEN RAISE EXCEPTION 'receipt replay'; END IF;
        SELECT id INTO protected_id FROM matches WHERE home_team_id='${uuid(1)}';
        SELECT id INTO replaced_id FROM matches WHERE home_team_id='${uuid(3)}';
        SELECT id INTO unchanged_id FROM matches WHERE home_team_id='${uuid(5)}';
        UPDATE matches SET status='arranged',ht_match_id=999 WHERE id=protected_id;
        INSERT INTO fixture_predicted_rating_shares VALUES(replaced_id);
        INSERT INTO fixture_warnings(round_id,team_id) VALUES(rid,'${uuid(4)}'),(rid,'${uuid(5)}');
        SELECT jsonb_agg(x) INTO roster FROM jsonb_array_elements(roster) x WHERE x->>'teamId'<>'${uuid(3)}';
        repaired:=jsonb_build_array(pairs->0,jsonb_build_object('home_team_id','${uuid(4)}','away_team_id',NULL,'scheduled_for',slot->>'date'),pairs->2);
        UPDATE tournament_slot_checks SET verification_id=verification,proposal_hash='repair';
        version:=get_organizer_round_context('${uuid(100)}',1)->>'rosterVersion';
        UPDATE tournament_slot_checks SET verification_id=NULL WHERE team_id='${uuid(4)}';
        BEGIN
          PERFORM save_verified_organizer_round('${uuid(100)}',1,version,slot,roster,repaired,false,rid,verification,'repair',42);
          RAISE EXCEPTION 'missing receipt accepted';
        EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Final verification%' THEN RAISE; END IF; END;
        UPDATE tournament_slot_checks SET verification_id=verification,observation='{"state":"unknown"}' WHERE team_id='${uuid(4)}';
        BEGIN
          PERFORM save_verified_organizer_round('${uuid(100)}',1,version,slot,roster,repaired,false,rid,verification,'repair',42);
          RAISE EXCEPTION 'unknown accepted';
        EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Availability%' THEN RAISE; END IF; END;
        IF NOT EXISTS(SELECT 1 FROM matches WHERE id=replaced_id) THEN RAISE EXCEPTION 'failed repair changed fixtures'; END IF;
        UPDATE tournament_slot_checks SET observation='{"state":"free","challengesKnown":true,"pendingOpponentIds":[]}' WHERE team_id='${uuid(4)}';
        -- Protected bookings do not depend on a successful optional offer read.
        UPDATE tournament_slot_checks SET observation='{"state":"unknown"}' WHERE team_id IN ('${uuid(1)}','${uuid(2)}');
        PERFORM save_verified_organizer_round('${uuid(100)}',1,version,slot,roster,repaired,false,rid,verification,'repair',42);
        IF NOT EXISTS(SELECT 1 FROM matches WHERE id=protected_id AND ht_match_id=999) THEN RAISE EXCEPTION 'protected identity changed'; END IF;
        IF NOT EXISTS(SELECT 1 FROM matches WHERE id=unchanged_id) THEN RAISE EXCEPTION 'unchanged identity changed'; END IF;
        IF EXISTS(SELECT 1 FROM matches WHERE id=replaced_id) OR EXISTS(SELECT 1 FROM fixture_predicted_rating_shares WHERE fixture_id=replaced_id) THEN RAISE EXCEPTION 'stale fixture data'; END IF;
        IF EXISTS(SELECT 1 FROM round_participants WHERE round_id=rid AND team_id='${uuid(3)}') THEN RAISE EXCEPTION 'removed participant retained'; END IF;
        IF (SELECT count(*) FROM teams WHERE active)<>6 THEN RAISE EXCEPTION 'membership changed'; END IF;
        IF EXISTS(SELECT 1 FROM fixture_warnings WHERE team_id='${uuid(4)}' AND active) THEN RAISE EXCEPTION 'stale warning'; END IF;
        IF NOT EXISTS(SELECT 1 FROM fixture_warnings WHERE team_id='${uuid(5)}' AND active) THEN RAISE EXCEPTION 'unrelated warning changed'; END IF;
        IF has_table_privilege('anon','tournament_slot_checks','SELECT') OR has_function_privilege('authenticated',
          'save_verified_organizer_round(uuid,integer,text,jsonb,jsonb,jsonb,boolean,uuid,uuid,text,bigint)','EXECUTE') THEN RAISE EXCEPTION 'public access'; END IF;
      END $$;
      SELECT 'organizer repair assertions completed';`);
    assert.match(output, /organizer repair assertions completed/);
  } finally { sql(`DROP DATABASE ${database};`, 'postgres'); }
});
