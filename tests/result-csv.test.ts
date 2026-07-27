import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResultCsv, RESULT_CSV_CLEAN_TEMPLATE, RESULT_CSV_TEMPLATE } from '../src/utils/result-csv';

test('result CSV template parses team and match rows', () => {
  const rows = parseResultCsv(RESULT_CSV_TEMPLATE);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].type, 'team');
  assert.equal(rows[0].teamId, 3220518);
  assert.equal(rows[1].type, 'team');
  assert.equal(rows[1].teamId, 3220511);
  assert.equal(rows[2].type, 'match');
  assert.equal(rows[2].round, 1);
  assert.equal(rows[2].appgOutcome, 'ET3');
  assert.equal(rows[2].went120, true);
  assert.deepEqual(rows.slice(2).map((row) => row.appgOutcome), ['ET3', 'PS1', 'RT0', 'OPW']);
});

test('clean result CSV template requires data rows before import', () => {
  assert.throws(() => parseResultCsv(RESULT_CSV_CLEAN_TEMPLATE), /header and at least one row/i);
});

test('result CSV rejects malformed row types and duplicate team rows', () => {
  assert.throws(
    () => parseResultCsv('type,team_id\nother,123'),
    /type must be team or match/i,
  );
  assert.throws(
    () => parseResultCsv('type,team_id\nteam,123\nteam,123'),
    /appears more than once/i,
  );
});

test('result CSV requires fixture identity for match rows', () => {
  assert.throws(
    () => parseResultCsv('type,round,home_team_id,away_team_id\nmatch,1,123,'),
    /require round, home_team_id, and away_team_id/i,
  );
});
