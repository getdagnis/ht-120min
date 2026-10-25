import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSurveyAnswers } from '../src/server/api/_lib/surveys.js';

test('a submission must answer each owned tournament team exactly once', () => {
  const answers = [
    { teamId: 'team-a', priority: 'flags', comments: 'New opponents, please.' },
    { teamId: 'team-b', priority: '120m', comments: '' },
  ];
  assert.deepEqual(validateSurveyAnswers(answers, ['team-a', 'team-b'], 'flag_hunters'), answers);
  assert.equal(validateSurveyAnswers(answers, ['team-a'], 'flag_hunters'), null);
  assert.equal(validateSurveyAnswers([answers[0], answers[0]], ['team-a', 'team-b'], 'flag_hunters'), null);
  assert.equal(validateSurveyAnswers([{ ...answers[0], teamId: 'someone-elses-team' }, answers[1]],
    ['team-a', 'team-b'], 'flag_hunters'), null);
});

test('the HFI variant rejects Flag Hunters choices and overlong comments', () => {
  assert.equal(validateSurveyAnswers([{ teamId: 'a', priority: 'flags', comments: '' }], ['a'], 'exotic_hfi'), null);
  assert.deepEqual(validateSurveyAnswers([{ teamId: 'a', priority: 'domestic', comments: '  fine  ' }], ['a'], 'exotic_hfi'),
    [{ teamId: 'a', priority: 'domestic', comments: 'fine' }]);
  assert.equal(validateSurveyAnswers([{ teamId: 'a', priority: 'domestic', comments: 'x'.repeat(1001) }],
    ['a'], 'exotic_hfi'), null);
});
