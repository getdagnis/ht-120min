export type PublicTournamentLoadResult<T> =
  | { status: 'loaded'; data: T }
  | { status: 'not-found' }
  | { status: 'failed'; data: T | null; error: unknown };

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
