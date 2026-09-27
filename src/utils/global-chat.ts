export const GLOBAL_CHAT_MAX_LENGTH = 500;

export function normalizeGlobalChatContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const content = value.trim();
  if (!content || Array.from(content).length > GLOBAL_CHAT_MAX_LENGTH) return null;
  return content;
}
