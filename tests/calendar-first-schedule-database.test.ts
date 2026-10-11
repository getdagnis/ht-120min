import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildLengthScheduleDraft, serializeLengthScheduleDraft, type SerializedLengthSchedulePayload } from '../src/utils/length-schedule.js';

// Explicitly opt into a disposable local socket. Never accept a remote DSN.
const socket = process.env.HT120_TEST_POSTGRES_SOCKET;
const enabled = Boolean(socket?.startsWith('/private/tmp/ht120-calendar-pg.'));
const sql = (input: string) => execFileSync('psql', ['-h', socket!, '-p', '55442', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'], { input, encoding: 'utf8' });
const quoted = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const cup = '00000000-0000-0000-0000-000000000001';
const uuid = (index: number) => `10000000-0000-0000-0000-${String(index).padStart(12, '0')}`;

function scenario(count: number, safeRounds: number, playoffs = 0, hfi = false) {
  const teams = Array.from({ length: count }, (_, i) => ({ id: uuid(i + 1), name: `Team ${i + 1}`, teamRank: hfi ? i + 1 : null, powerRating: 1000 - i, countryName: 'England', leagueLevel: 1 }));
  const draft = buildLengthScheduleDraft({ teams, rankingSource: hfi ? 'team_rank' : 'power_rating', now: new Date('2030-01-01T00:00:00Z'), startSlotId: null });
  assert.ok(draft.safeRoundCount >= safeRounds);
  const payload = serializeLengthScheduleDraft(draft);
  payload.total_rounds = safeRounds;
  payload.regular_rounds = safeRounds - playoffs;
  payload.postseason_rounds = playoffs;
  payload.format = playoffs ? 'fill_playoffs' : 'fill';
  payload.rounds = payload.rounds.slice(0, safeRounds).map((round, i) => ({ ...round, phase: i < payload.regular_rounds ? 'regular' : 'postseason', phase_round_number: i < payload.regular_rounds ? i + 1 : i - payload.regular_rounds + 1 }));
  payload.regular_pairings = payload.regular_pairings.slice(0, payload.regular_rounds);
  const seed = payload.ranking_snapshot.map(row => row.team_id);
  const inserts = `INSERT INTO tournaments(id, league_category) VALUES ('${cup}', '${hfi ? 'hfi' : 'male'}');\n` + teams.map(team => `INSERT INTO teams(id,tournament_id,name,ht_team_id,team_rank,power_rating) VALUES ('${team.id}','${cup}','${team.name}',1,${team.teamRank ?? 'NULL'},${team.powerRating});`).join('\n');
  return { payload, seed, inserts };
}

function generation(payload: SerializedLengthSchedulePayload | Record<string, unknown>) {
  return `SELECT generate_length_tournament_schedule('${cup}',1,${quoted(payload)});`;
}

function transition(round: number, pairings: Array<Record<string, unknown>>, last = false, champion?: string) {
  return `UPDATE matches SET completed=true,status='finished' WHERE round_id=(SELECT id FROM rounds WHERE round_number=${round});
    SELECT apply_length_round_transition('${cup}',1,(SELECT id FROM rounds WHERE round_number=${round}),
      ${last ? 'NULL' : `(SELECT id FROM rounds WHERE round_number=${round + 1})`},${quoted(pairings)},${champion ? `'${champion}'::uuid` : 'NULL'});`;
}

function plannedMatches(payload: SerializedLengthSchedulePayload, seed: string[], round: number) {
  return payload.regular_pairings[round - 1]!.map(pair => ({ home_team_id: seed[pair.home_slot_index - 1], away_team_id: pair.away_slot_index ? seed[pair.away_slot_index - 1] : null, scheduled_for: payload.rounds[round - 1]!.slot_date }));
}

test('calendar-first generation and atomic progression execute in disposable PostgreSQL', { skip: !enabled }, () => {
  sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  sql(readFileSync(new URL('./fixtures/calendar-schedule-schema.sql', import.meta.url), 'utf8'));
  sql(readFileSync(new URL('../migrations/107_calendar_first_generated_schedules.sql', import.meta.url), 'utf8'));
  sql('CREATE TRIGGER protect_length_metadata BEFORE INSERT OR UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION protect_length_match_resolution();');

  for (const [count, rounds, playoffs, hfi] of [[4, 5, 0, false], [4, 6, 0, false], [5, 5, 0, false], [6, 6, 1, true], [8, 6, 2, false], [12, 8, 3, true]] as const) {
    const { payload, seed, inserts } = scenario(count, rounds, playoffs, hfi);
    let script = 'BEGIN;\n' + inserts + generation(payload);
    script += `DO $$ BEGIN
      IF (SELECT count(*) FROM rounds) <> ${rounds} OR (SELECT count(*) FROM matches) <> ${Math.ceil(count / 2)} THEN RAISE EXCEPTION 'Initial reservation failed'; END IF;
      BEGIN PERFORM generate_length_tournament_schedule('${cup}',1,${quoted(payload)}); RAISE EXCEPTION 'Duplicate generation accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
    END $$;`;
    for (let r = 1; r < payload.regular_rounds; r++) script += transition(r, plannedMatches(payload, seed, r + 1));
    if (playoffs) {
      let qualifiers = seed.slice(0, 2 ** playoffs);
      for (let p = 1; p <= playoffs; p++) {
        const current = payload.regular_rounds + p - 1;
        const matches = Array.from({ length: qualifiers.length / 2 }, (_, i) => ({ home_team_id: qualifiers[i * 2], away_team_id: qualifiers[i * 2 + 1], playoff_match_number: i + 1, scheduled_for: payload.rounds[current]!.slot_date }));
        script += transition(current, matches);
        script += `DO $$ BEGIN IF (SELECT count(*) FROM matches WHERE round_id=(SELECT id FROM rounds WHERE round_number=${current + 1})) <> ${matches.length} THEN RAISE EXCEPTION 'Playoff materialization failed'; END IF; END $$;`;
        qualifiers = matches.map(match => match.home_team_id!);
      }
      script += transition(rounds, [], true, qualifiers[0]);
    } else script += transition(rounds, [], true);
    script += `DO $$ BEGIN IF (SELECT count(*) FROM rounds WHERE phase_status <> 'completed') <> 0 THEN RAISE EXCEPTION 'Season not completed'; END IF; END $$;`;
    const retryRound = Math.min(2, rounds);
    script += `SELECT apply_length_round_transition('${cup}',1,(SELECT id FROM rounds WHERE round_number=1),(SELECT id FROM rounds WHERE round_number=${retryRound}),'[]'::jsonb,NULL);`;
    script += 'ROLLBACK;';
    assert.match(sql(script), /already_completed/);
  }

  const { payload, inserts } = scenario(4, 5);
  const forged = structuredClone(payload);
  forged.ranking_snapshot[0]!.ranking_value = 5000;
  assert.throws(() => sql('BEGIN;' + inserts + generation(forged) + 'ROLLBACK;'), /Ranking data changed/);
  const legacy = scenario(6, 6, 1, true);
  const legacyPayload = {
    ...legacy.payload, version: 1, format: 'round_robin_plus_final',
    ranking_snapshot: legacy.payload.ranking_snapshot.map(row => ({ team_id: row.team_id, team_rank: row.ranking_value })),
  };
  const legacyResult = sql('BEGIN;' + legacy.inserts + generation(legacyPayload) +
    "SELECT schedule_plan_json->>'version' FROM tournament_seasons; ROLLBACK;");
  assert.match(legacyResult, /\n1\n/);
  assert.throws(() => sql('BEGIN;' + inserts + generation(payload) +
    'GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT ON rounds,tournaments TO authenticated; GRANT SELECT,UPDATE ON matches TO authenticated; SET LOCAL ROLE authenticated; UPDATE matches SET playoff_match_number=9; ROLLBACK;'), /server-owned/);
  const permissions = sql("SELECT has_function_privilege('anon','public.generate_length_tournament_schedule(uuid,integer,jsonb)','EXECUTE'),has_function_privilege('authenticated','public.apply_length_round_transition(uuid,integer,uuid,uuid,jsonb,uuid)','EXECUTE');");
  assert.equal(permissions.trim(), 'f|f');
});
