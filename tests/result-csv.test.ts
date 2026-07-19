import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResultCsv, RESULT_CSV_TEMPLATE } from '../src/utils/result-csv';

test('result CSV template parses team and match rows', () => {
  const rows = parseResultCsv(RESULT_CSV_TEMPLATE);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'team');
  assert.equal(rows[0].teamId, 3220518);
  assert.equal(rows[1].type, 'match');
  assert.equal(rows[1].round, 1);
  assert.equal(rows[1].appgOutcome, 'ET3');
  assert.equal(rows[1].went120, true);
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
