export interface TournamentCardMatch {
  completed?: boolean | null;
  status?: string | null;
}

export interface TournamentCardRound {
  round_number: number;
  matches?: readonly TournamentCardMatch[] | null;
}

export interface TournamentCardSummary {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  season: number;
  status?: string | null;
  rounds?: readonly TournamentCardRound[] | null;
  totalRounds: number;
  completedRounds: number;
  totalMatches: number;
  completedMatches: number;
  teamCount: number;
  max_teams?: number | null;
  startedAt?: string | Date | null;
  plannedStartDate?: string | Date | null;
  finishedAt?: string | Date | null;
  description?: string | null;
  image_url?: string | null;
  hasNewsArticle?: boolean;
  updated_at?: string | Date | null;
}

export function getTournamentCardDescription(description: string | null | undefined) {
  const words = description?.trim().split(/\s+/).filter(Boolean) || [];
  if (words.length <= 20) return words.join(' ');
  return `${words.slice(0, 20).join(' ')}...`;
}

function timestamp(value: string | Date | null | undefined) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function isCompleted(match: TournamentCardMatch) {
  return Boolean(match.completed) || match.status === 'misarranged';
}

export function getCurrentRoundNumber(tournament: TournamentCardSummary) {
  const rounds = tournament.rounds || [];
  const active = [...rounds]
    .filter((round) => (round.matches || []).length > 0)
    .sort((a, b) => a.round_number - b.round_number)
    .find((round) => !(round.matches || []).every(isCompleted));
  return active?.round_number ?? (tournament.totalRounds > 0
    ? Math.min(tournament.completedRounds + 1, tournament.totalRounds)
    : null);
}

export function getTournamentStateLabel(tournament: TournamentCardSummary) {
  const season = `season ${tournament.season}`;
  if (tournament.status === 'finished' ||
      (tournament.totalMatches > 0 && tournament.totalMatches === tournament.completedMatches)) return `${season} finished`;
  if (tournament.status === 'paused') return `${season} paused`;
  if ((tournament.rounds || []).length > 0) return `${season} ongoing`;
  return `waiting participants for ${season}`;
}

export function getTournamentCardDateLabel(tournament: TournamentCardSummary) {
  const hasRounds = (tournament.rounds || []).length > 0;
  const finished = tournament.status === 'finished' ||
    (tournament.totalMatches > 0 && tournament.totalMatches === tournament.completedMatches);
  const value = finished
    ? tournament.finishedAt || tournament.startedAt || tournament.plannedStartDate || tournament.created_at
    : hasRounds || tournament.status === 'active' || tournament.status === 'paused'
      ? tournament.startedAt || tournament.plannedStartDate || tournament.created_at
      : tournament.plannedStartDate || tournament.created_at;
  const date = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Riga',
  }).format(new Date(value));
  return `${finished ? 'Finished' : hasRounds || tournament.status === 'active' || tournament.status === 'paused' ? 'Started' : 'Planned'}: ${date}`;
}

// More mature, more played and larger tournaments lead; recent starts/plans
// break remaining activity ties. Collection order may then break exact ties.
export function compareTournamentActivityScore<T extends TournamentCardSummary>(a: T, b: T) {
  const date = (row: T) => (row.rounds || []).length > 0
    ? timestamp(row.startedAt || row.plannedStartDate || row.created_at)
    : timestamp(row.plannedStartDate || row.startedAt || row.created_at);
  return b.season - a.season ||
    b.completedRounds - a.completedRounds ||
    b.teamCount - a.teamCount ||
    date(b) - date(a);
}

export function compareTournamentActivity<T extends TournamentCardSummary>(a: T, b: T) {
  // General lists use stable identity when the activity score is equal.
  return compareTournamentActivityScore(a, b) ||
    a.slug.localeCompare(b.slug) ||
    a.id.localeCompare(b.id);
}

// Unstarted, paused and completed listings use public signs that a tournament
// is ready to explore. The date is the final criterion, never a replacement for
// participants or content.
export function compareTournamentNonOngoingScore<T extends TournamentCardSummary>(a: T, b: T) {
  const presence = (value: boolean) => Number(value);
  return presence(b.teamCount > 0) - presence(a.teamCount > 0) ||
    presence(Boolean(b.image_url)) - presence(Boolean(a.image_url)) ||
    presence(Boolean(b.image_url && b.description?.trim() && b.hasNewsArticle)) -
      presence(Boolean(a.image_url && a.description?.trim() && a.hasNewsArticle)) ||
    timestamp(b.updated_at || b.created_at) - timestamp(a.updated_at || a.created_at);
}
