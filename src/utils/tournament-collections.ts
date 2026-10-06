export interface CollectionMember<T> {
  tournament: T;
  isFeatured: boolean;
  displayOrder: number;
}

export interface PublicCollection<T> {
  id: string;
  slug: string;
  title: string;
  description: string;
  bannerUrl: string | null;
  displayOrder: number;
  members: CollectionMember<T>[];
}

export type CollectionTournament = {
  id: string;
  slug: string;
  status?: string | null;
  registration_closed_at?: string | null;
  rounds: readonly unknown[];
  totalMatches: number;
  completedMatches: number;
};

export function collectionGroup(tournament: CollectionTournament) {
  if (['finished', 'stopped', 'archived'].includes(tournament.status || '') ||
      (tournament.totalMatches > 0 && tournament.totalMatches === tournament.completedMatches)) return 'completed';
  if (tournament.rounds.length > 0) return 'in-progress';
  if (!tournament.registration_closed_at && (tournament.status === 'open' || tournament.status === 'waiting')) return 'registration-open';
  return 'upcoming';
}

// Public baseline only. Viewer-specific joined/eligible ordering can be layered
// above this result later without changing the shared publication.
export function selectCollectionHomepageMembers<T extends CollectionTournament>(
  members: readonly CollectionMember<T>[], limit = 8,
): CollectionMember<T>[] {
  const rank = (member: CollectionMember<T>) => {
    const group = collectionGroup(member.tournament);
    return group === 'registration-open' ? 0 : group === 'in-progress' ? 1 : group === 'upcoming' ? 2 : 3;
  };
  const byOrder = (a: CollectionMember<T>, b: CollectionMember<T>) =>
    a.displayOrder - b.displayOrder || a.tournament.slug.localeCompare(b.tournament.slug) ||
    a.tournament.id.localeCompare(b.tournament.id);
  const featured = members.filter((member) => member.isFeatured).sort(byOrder);
  const fallback = members.filter((member) => !member.isFeatured)
    .sort((a, b) => rank(a) - rank(b) || byOrder(a, b));
  return [...featured, ...fallback].slice(0, limit);
}
