import type { TournamentJoinStory } from '../types/tournament-activity';

export interface JoinStoryManagerSummary {
  name: string | null;
  href: string | null;
  flag: string | null;
}

function isStory(value: unknown): value is TournamentJoinStory {
  return (
    Array.isArray(value) &&
    value.every(
      (part) =>
        part &&
        typeof part === 'object' &&
        typeof (part as { text?: unknown }).text === 'string' &&
        ((part as { href?: unknown }).href === undefined || typeof (part as { href?: unknown }).href === 'string'),
    )
  );
}

export function getJoinStoryManagerSummary(value: unknown): JoinStoryManagerSummary {
  if (!isStory(value) || value.length === 0) return { name: null, href: null, flag: null };

  const manager = value[0];
  const storyTextAfterManager = value
    .slice(1)
    .map((part) => part.text)
    .join('');
  const originStart = storyTextAfterManager.indexOf(' from ');
  const joinStart = storyTextAfterManager.indexOf(' joined tournament', originStart);
  const originText = originStart >= 0 ? storyTextAfterManager.slice(originStart, joinStart >= 0 ? joinStart : undefined) : '';
  const flag = originText.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0] || null;

  return {
    name: manager.text.trim() || null,
    href: manager.href || null,
    flag,
  };
}
