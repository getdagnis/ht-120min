type FeaturedSortable = {
  is_featured?: boolean | null;
};

export const sortFeaturedFirst = <T extends FeaturedSortable>(items: T[], comparator: (a: T, b: T) => number) =>
  [...items].sort((a, b) => {
    const featuredA = a.is_featured ? 1 : 0;
    const featuredB = b.is_featured ? 1 : 0;
    if (featuredA !== featuredB) return featuredB - featuredA;
    return comparator(a, b);
  });
