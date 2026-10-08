export type PublicTournamentLoadResult<T> =
  | { status: 'loaded'; data: T }
  | { status: 'not-found' }
  | { status: 'failed'; data: T | null; error: unknown };

/** A cached miss is not enough to send a visitor to a 404 page. */
export async function confirmPublicTournamentMiss<T>(
  cachedData: T | null,
  verifyFresh: () => Promise<T | null>,
): Promise<T | null> {
  return cachedData === null ? verifyFresh() : cachedData;
}

/** Keep read failures distinct from a successful lookup that returned no row. */
export async function readPublicTournament<T>(
  read: () => Promise<T | null>,
  lastGoodData: T | null = null,
): Promise<PublicTournamentLoadResult<T>> {
  try {
    const data = await read();
    return data === null ? { status: 'not-found' } : { status: 'loaded', data };
  } catch (error) {
    return { status: 'failed', data: lastGoodData, error };
  }
}
