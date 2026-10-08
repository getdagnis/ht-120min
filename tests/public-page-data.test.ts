import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_DATA_READ_TIMEOUT_MS } from '../src/utils/public-data-config.js';
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
