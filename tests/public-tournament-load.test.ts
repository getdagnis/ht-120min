import assert from 'node:assert/strict';
import test from 'node:test';
import { readPublicTournament } from '../src/utils/public-tournament-load';

test('a cached tournament remains available when revalidation times out', async () => {
  const lastGood = { id: 'tahiti', name: 'Exotic HFI — Tahiti' };
  const result = await readPublicTournament(async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }, lastGood);

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.strictEqual(result.data, lastGood);
});

test('a first-load timeout is recoverable and is not a not-found result', async () => {
  const result = await readPublicTournament(async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });

  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.equal(result.data, null);
});

test('a successful lookup with no matching slug is not found', async () => {
  const result = await readPublicTournament(async () => null);

  assert.deepEqual(result, { status: 'not-found' });
});

test('a failed refresh leaves the last good value available for a later retry', async () => {
  const lastGood = { id: 'tahiti', version: 1 };
  const failed = await readPublicTournament(async () => {
    throw new Error('timeout');
  }, lastGood);
  const retried = await readPublicTournament(async () => ({ id: 'tahiti', version: 2 }),
    failed.status === 'failed' ? failed.data : null);

  assert.equal(failed.status, 'failed');
  if (failed.status === 'failed') assert.strictEqual(failed.data, lastGood);
  assert.deepEqual(retried, { status: 'loaded', data: { id: 'tahiti', version: 2 } });
});
