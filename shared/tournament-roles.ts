export const TOURNAMENT_ROLE_VALUES = ['co_organizer', 'admin', 'press_officer'] as const;

export type TournamentRole = (typeof TOURNAMENT_ROLE_VALUES)[number];

export const TOURNAMENT_ROLE_LABELS: Record<TournamentRole, string> = {
  co_organizer: 'Co-organiser',
  admin: 'Tournament admin',
  press_officer: 'Press officer',
};

export function isTournamentRole(value: unknown): value is TournamentRole {
  return typeof value === 'string' && TOURNAMENT_ROLE_VALUES.includes(value as TournamentRole);
}
