export type TournamentStatus = 'planning' | 'recruiting' | 'open' | 'waiting' | 'active' | 'paused' | 'stopped' | 'finished' | 'archived';

export function isExclusiveTournament(tournament: {
  status?: string | null;
  is_test?: boolean | null;
  registration_type?: string | null;
}) {
  return !tournament.is_test && tournament.registration_type !== 'sandbox' &&
    !['planning', 'finished', 'stopped', 'archived'].includes(tournament.status ?? '');
}
