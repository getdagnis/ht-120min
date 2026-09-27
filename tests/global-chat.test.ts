import assert from 'node:assert/strict';
import test from 'node:test';

import { GLOBAL_CHAT_MAX_LENGTH, normalizeGlobalChatContent } from '../src/utils/global-chat.js';

test('global chat content is trimmed and rejects empty messages', () => {
  assert.equal(normalizeGlobalChatContent('  hello  '), 'hello');
  assert.equal(normalizeGlobalChatContent('   '), null);
  assert.equal(normalizeGlobalChatContent(null), null);
});

test('global chat content has a bounded length', () => {
  assert.equal(normalizeGlobalChatContent('x'.repeat(GLOBAL_CHAT_MAX_LENGTH)), 'x'.repeat(GLOBAL_CHAT_MAX_LENGTH));
  assert.equal(normalizeGlobalChatContent('x'.repeat(GLOBAL_CHAT_MAX_LENGTH + 1)), null);
});
