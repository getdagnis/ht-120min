import { compareTournamentActivityScore, compareTournamentNonOngoingScore, type TournamentCardSummary } from './tournament-card-details.js';

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
  homepageGroup?: string | null;
  displayOrder: number;
  members: CollectionMember<T>[];
}

export const COLLECTION_HOMEPAGE_GROUPS = [
  { id: 'concept-120min', title: 'Concept 120 min Friendly Tournaments' },
  { id: 'virtual-concept', title: 'Non-Scheduled Concept Tournaments' },
  { id: 'hop-on-hop-off', title: 'Hop-On Hop-Off Tournaments' },
] as const;

export function collectionHomepageGroup(collection: Pick<PublicCollection<unknown>, 'slug' | 'homepageGroup'>) {
  if (COLLECTION_HOMEPAGE_GROUPS.some((group) => group.id === collection.homepageGroup)) return collection.homepageGroup;
  // Contract-1 publications built before the group column still contain the
  // first collection. Its known slug has a stable placement during rollout.
  if (collection.homepageGroup === undefined && collection.slug === 'exotic-hfi') return 'concept-120min';
  return null;
}

export function groupHomepageCollections<T>(collections: readonly PublicCollection<T>[]) {
  return [
    ...COLLECTION_HOMEPAGE_GROUPS,
    { id: 'other', title: 'Collections' },
  ].map((group) => ({
    ...group,
    collections: collections.filter((collection) =>
      (collectionHomepageGroup(collection) ?? 'other') === group.id)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.slug.localeCompare(b.slug)),
  })).filter((group) => group.collections.length > 0);
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
  if (tournament.status === 'paused') return 'inactive';
  if (tournament.rounds.length > 0) return 'in-progress';
  if (!tournament.registration_closed_at && (tournament.status === 'open' || tournament.status === 'waiting')) return 'registration-open';
  return 'upcoming';
}

export function collectionPageGroups<T extends CollectionTournament>(member: CollectionMember<T>) {
  const statusGroup = collectionGroup(member.tournament);
  return member.isFeatured ? ['featured', statusGroup] : [statusGroup];
}

export function compareCollectionMemberActivity<T extends TournamentCardSummary>(
  a: CollectionMember<T>, b: CollectionMember<T>,
) {
  return compareTournamentListingScore(a.tournament, b.tournament) ||
    a.displayOrder - b.displayOrder || a.tournament.slug.localeCompare(b.tournament.slug) ||
    a.tournament.id.localeCompare(b.tournament.id);
}

function listingGroup(tournament: TournamentCardSummary) {
  return collectionGroup({
    ...tournament,
    rounds: tournament.rounds || [],
  });
}

function compareTournamentListingScore<T extends TournamentCardSummary>(a: T, b: T) {
  const aGroup = listingGroup(a);
  const bGroup = listingGroup(b);
  if (aGroup === 'in-progress' && bGroup !== 'in-progress') return -1;
  if (bGroup === 'in-progress' && aGroup !== 'in-progress') return 1;
  if (aGroup === 'in-progress') return compareTournamentActivityScore(a, b);
  return compareTournamentNonOngoingScore(a, b);
}

export function compareTournamentListing<T extends TournamentCardSummary>(a: T, b: T) {
  return compareTournamentListingScore(a, b) || a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id);
}

// Public baseline only. Viewer-specific joined/eligible ordering can be layered
// above this result later without changing the shared publication.
export function selectCollectionHomepageMembers<T extends CollectionTournament & TournamentCardSummary>(
  members: readonly CollectionMember<T>[], limit = 8,
): CollectionMember<T>[] {
  return [...members]
    .sort((a, b) => compareCollectionMemberActivity(a, b))
    .slice(0, limit);
}
