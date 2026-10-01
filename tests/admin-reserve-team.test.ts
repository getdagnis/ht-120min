import assert from 'node:assert/strict';
import test from 'node:test';

import appHandler from '../src/server/api/app.js';

test('admin reserve-team endpoint accepts a numeric JSON Hattrick team ID before authorization', async () => {
  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      payload = value;
      return response;
    },
  };

  await appHandler(
    {
      method: 'POST',
      query: { route: 'admin-add-reserve-team' },
      body: { tournamentId: 'tournament', teamId: 3228800 },
      headers: {},
    } as never,
    response as never,
  );

  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: 'Please sign in with Hattrick first.' });
});
