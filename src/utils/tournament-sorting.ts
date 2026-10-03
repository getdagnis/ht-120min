type FeaturedSortable = {
  is_featured?: boolean | null;
  created_at?: string | Date | null;
};

export const sortFeaturedFirst = <T extends FeaturedSortable>(items: T[], comparator: (a: T, b: T) => number) =>
  [...items].sort((a, b) => {
    const featuredA = a.is_featured ? 1 : 0;
    const featuredB = b.is_featured ? 1 : 0;
    if (featuredA !== featuredB) return featuredB - featuredA;

    if (featuredA === 1 && a.created_at && b.created_at) {
      const createdAtDelta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (createdAtDelta !== 0) return createdAtDelta;
    }

    return comparator(a, b);
  });
export const sortOpenTournaments = <T extends { teamCount: number; max_teams?: number | null; is_featured?: boolean | null }>(
  tournaments: T[],
): T[] => sortFeaturedFirst(tournaments, (a, b) => {
  const scoreA = a.max_teams && a.max_teams > 0 ? a.teamCount / a.max_teams : a.teamCount;
  const scoreB = b.max_teams && b.max_teams > 0 ? b.teamCount / b.max_teams : b.teamCount;
  return scoreB - scoreA;
});
