import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GLOBAL_CHAT_WELCOME,
  DEFAULT_TOURNAMENT_CHAT_WELCOME,
  withChatWelcome,
  type ChatWelcomeMessage,
} from '../src/utils/chat-welcome';

const userMessage: ChatWelcomeMessage = {
  id: 'message-1',
  author_name: 'Kansas6',
  content: 'Hello!',
  created_at: '2026-09-28T10:00:00.000Z',
  author_ht_id: 12895530,
};

test('adds the tournament welcome in the UI when the stored message is missing', () => {
  const messages = withChatWelcome([userMessage], DEFAULT_TOURNAMENT_CHAT_WELCOME);

  assert.equal(messages[0].content, DEFAULT_TOURNAMENT_CHAT_WELCOME);
  assert.equal(messages[0].author_ht_id, 0);
  assert.equal(messages[1], userMessage);
});

test('does not duplicate an existing welcome and supports global chat copy', () => {
  const welcome: ChatWelcomeMessage = {
    id: 'welcome-1',
    author_name: 'HT-120min',
    content: DEFAULT_GLOBAL_CHAT_WELCOME,
    created_at: '2026-09-28T09:00:00.000Z',
    author_ht_id: 0,
  };

  const messages = withChatWelcome([welcome, userMessage], DEFAULT_GLOBAL_CHAT_WELCOME);

  assert.equal(messages.length, 2);
  assert.equal(messages[0], welcome);
});

test('does not add the starter message once a quiet chat has reached five messages', () => {
  const messages = Array.from({ length: 5 }, (_, index) => ({
    ...userMessage,
    id: `message-${index + 1}`,
  }));

  assert.deepEqual(withChatWelcome(messages, DEFAULT_TOURNAMENT_CHAT_WELCOME), messages);
});
