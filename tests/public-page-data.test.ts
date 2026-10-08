import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPublicDataReadTimeoutMs, getPublicDataRetryHref, parsePublicDataAttempt, PUBLIC_DATA_READ_TIMEOUT_MS,
} from '../src/utils/public-data-config.js';
import { readCollectionPageData, readHomePageData } from '../src/utils/public-page-data.js';

const homeData = {
  featuredTournaments: [], activeTournaments: [], openTournaments: [],
  collections: [
    { id: 'collection', slug: 'tahiti', title: 'Tahiti', description: '', bannerUrl: null, displayOrder: 0, members: [] },
  ],
  topTeams: [], topActiveTournaments: [], activity: [],
};

test('shared public reads use the requested six-second timeout', () => {
  assert.equal(PUBLIC_DATA_READ_TIMEOUT_MS, 6_000);
  assert.deepEqual([1, 2, 3].map(getPublicDataReadTimeoutMs), [6_000, 8_000, 10_000]);
  assert.equal(getPublicDataReadTimeoutMs(4), 10_000);
});

test('public read retry attempts are bounded and advance up to the final timeout', () => {
  assert.equal(parsePublicDataAttempt(undefined), 1);
  assert.equal(parsePublicDataAttempt('2'), 2);
  assert.equal(parsePublicDataAttempt('99'), 1);
  assert.equal(getPublicDataRetryHref('/en/collection/tahiti', 1), '/en/collection/tahiti?publicDataAttempt=2');
  assert.equal(getPublicDataRetryHref('/en?from=home', 3), '/en?from=home&publicDataAttempt=3');
});

test('Home consumer exposes a recoverable unavailable result after a cold read failure', async () => {
  const result = await readHomePageData(async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });

  assert.equal(result.status, 'unavailable');
});

test('collection consumer exposes a recoverable unavailable result after a cold read failure', async () => {
  const result = await readCollectionPageData(async () => {
    throw new Error('Supabase query failed');
  }, 'tahiti');

  assert.equal(result.status, 'unavailable');
});

test('collection consumer reports not found only after a successful lookup with no matching slug', async () => {
  const result = await readCollectionPageData(async () => ({ ...homeData, collections: [] }), 'missing');

  assert.deepEqual(result, { status: 'not-found' });
});

test('collection consumer retains the published collection when the read succeeds', async () => {
  const result = await readCollectionPageData(async () => homeData, 'tahiti');

  assert.equal(result.status, 'loaded');
  if (result.status === 'loaded') assert.equal(result.data.slug, 'tahiti');
});
