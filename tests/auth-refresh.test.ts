import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_REFRESH_VERSION_KEY,
  REQUIRED_AUTH_REFRESH_VERSION,
  markAuthRefreshCurrent,
  needsAuthRefresh,
} from '../src/utils/auth-refresh';

function createStorage(): Storage {
  const items = new Map<string, string>();

  return {
    get length() {
      return items.size;
    },
    clear() {
      items.clear();
    },
    getItem(key: string) {
      return items.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(items.keys())[index] ?? null;
    },
    removeItem(key: string) {
      items.delete(key);
    },
    setItem(key: string, value: string) {
      items.set(key, value);
    },
  };
}

test('auth refresh is needed until the current release version is stored', () => {
  const storage = createStorage();

  assert.equal(needsAuthRefresh(storage), true);

  markAuthRefreshCurrent(storage);

  assert.equal(storage.getItem(AUTH_REFRESH_VERSION_KEY), REQUIRED_AUTH_REFRESH_VERSION);
  assert.equal(needsAuthRefresh(storage), false);
});
