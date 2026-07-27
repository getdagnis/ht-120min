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
