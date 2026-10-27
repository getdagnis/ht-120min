import assert from 'node:assert/strict';
import test from 'node:test';
import { SpotlightBrowser } from '../src/components/ManagerSpotlight/spotlight-browser.js';
import type { ManagerSpotlight } from '../src/utils/manager-spotlight.js';

const profile = (managerId: number): ManagerSpotlight => ({
  managerId, managerName: `Manager ${managerId}`, avatar: null, location: [], language: null,
  currentTeams: [], tournamentTeamId: managerId, story: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settled = () => new Promise<void>(resolve => setImmediate(resolve));

test('Next switches before loading, deduplicates requests and profiles, and stays navigable', async () => {
  const request = deferred<ManagerSpotlight[]>();
  let calls = 0;
  const browser = new SpotlightBrowser(profile(1), [profile(1), profile(2)], () => {
    calls++;
    assert.equal(browser.getSnapshot().spotlight?.managerId, 2);
    return request.promise;
  });
  const changes: number[] = [];
  const unsubscribe = browser.subscribe(() => changes.push(browser.getSnapshot().spotlight!.managerId));
  browser.next();
  assert.equal(browser.getSnapshot().spotlight?.managerId, 2);
  assert.equal(browser.getSnapshot().loading, true);
  browser.next(); // The loaded first profile remains usable during the request.
  assert.equal(browser.getSnapshot().spotlight?.managerId, 1);
  await browser.retry();
  assert.equal(calls, 1);
  request.resolve([profile(2), profile(3), profile(3)]);
  await settled();
  assert.deepEqual(browser.getSnapshot().available.map(p => p.managerId), [1, 2, 3]);
  assert.equal(browser.getSnapshot().loading, false);
  browser.next();
  assert.ok([2, 3].includes(browser.getSnapshot().spotlight!.managerId));
  assert.equal(calls, 1);
  assert.ok(changes.includes(2));
  unsubscribe();
});

test('failed loading preserves both profiles and explicit retry succeeds without switching', async () => {
  const first = deferred<ManagerSpotlight[]>();
  const second = deferred<ManagerSpotlight[]>();
  let calls = 0;
  const browser = new SpotlightBrowser(profile(1), [profile(2)], () => ++calls === 1 ? first.promise : second.promise);
  browser.next();
  first.reject(new Error('Offline'));
  await settled();
  assert.equal(browser.getSnapshot().failed, true);
  assert.deepEqual(browser.getSnapshot().available.map(p => p.managerId), [1, 2]);
  assert.equal(browser.getSnapshot().spotlight?.managerId, 2);
  const retry = browser.retry();
  assert.equal(browser.getSnapshot().loading, true);
  assert.equal(browser.getSnapshot().spotlight?.managerId, 2);
  browser.next();
  assert.equal(browser.getSnapshot().spotlight?.managerId, 1);
  browser.next();
  assert.equal(browser.getSnapshot().spotlight?.managerId, 2);
  assert.equal(calls, 2);
  second.resolve([profile(3)]);
  await retry;
  assert.equal(browser.getSnapshot().failed, false);
  assert.equal(browser.getSnapshot().loading, false);
  assert.deepEqual(browser.getSnapshot().available.map(p => p.managerId), [1, 2, 3]);
});

test('single-manager list does not start a browse-all request', () => {
  const browser = new SpotlightBrowser(profile(1), [], async () => { throw new Error('Must not run'); });
  browser.next();
  assert.equal(browser.getSnapshot().loading, false);
  assert.equal(browser.getSnapshot().spotlight?.managerId, 1);
});

test('missing prefetch can load remaining candidates from a single daily profile', async () => {
 const request = deferred<ManagerSpotlight[]>();
 const browser = new SpotlightBrowser(profile(1), [profile(1)], () => request.promise, true);
 browser.next();
 assert.equal(browser.getSnapshot().loading, true);
 assert.equal(browser.getSnapshot().spotlight?.managerId, 1);
 request.resolve([profile(1), profile(2)]);
 await settled();
 browser.next();
 assert.equal(browser.getSnapshot().spotlight?.managerId, 2);
});
