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
  const origin = value.slice(1).find((part) => part.text.includes(' from '));
  const flag = origin?.text.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0] || null;

  return {
    name: manager.text.trim() || null,
    href: manager.href || null,
    flag,
  };
}
