export const DEFAULT_TOURNAMENT_CHAT_WELCOME = 'This is tournament chat. Login and say hello to everybody!';
export const DEFAULT_GLOBAL_CHAT_WELCOME = 'This is HT-120min chat. Login and say hello to everybody!';

const CHAT_WELCOME_MESSAGE_LIMIT = 5;

export interface ChatWelcomeMessage {
  id: string;
  author_name: string;
  content: string;
  created_at: string;
  author_ht_id: number;
}

export function withChatWelcome<T extends ChatWelcomeMessage>(messages: T[], welcomeMessage: string): T[] {
  if (
    messages.length >= CHAT_WELCOME_MESSAGE_LIMIT ||
    messages.some((message) => message.author_ht_id === 0 && message.content === welcomeMessage)
  ) {
    return messages;
  }

  return [
    {
      id: `default-chat-welcome:${welcomeMessage}`,
      author_name: 'HT-120min',
      content: welcomeMessage,
      created_at: '1970-01-01T00:00:00.000Z',
      author_ht_id: 0,
    } as T,
    ...messages,
  ];
}
