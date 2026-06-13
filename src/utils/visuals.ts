/**
 * Generates a stable background position based on a string ID.
 * This is used to show a "unique" crop of a large master image.
 */
export const getTournamentBackgroundStyle = (id: string, customImageUrl?: string | null) => {
  if (customImageUrl) {
    return {
      backgroundImage: `url(${customImageUrl})`,
      backgroundPosition: 'center',
      backgroundSize: 'cover',
    };
  }

  // Simple hash function for stable random-ish numbers
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  // Use hash to get X and Y percentages (0-100)
  // We use different bits of the hash for X and Y
  const x = Math.abs(hash % 100);
  const y = Math.abs(Math.floor(hash / 100) % 100);

  return {
    backgroundImage: 'var(--tournament-thumb)',
    backgroundPosition: `${x}% ${y}%`,
    backgroundSize: '800%', // Zoom in to see "random objects" at decent scale
  };
};

/**
 * Specifically for small header thumbnails
 */
export const getHeaderThumbnailStyle = (id: string) => {
  const base = getTournamentBackgroundStyle(id);
  return {
    ...base,
    backgroundSize: '1200%', // Even more zoom for tiny thumbnails
  };
};
