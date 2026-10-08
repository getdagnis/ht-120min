import type { HomeInitialData, HomeTournament } from '../server/api/_lib/home-snapshot-builder.js';
import type { PublicCollection } from './tournament-collections.js';

export type PublicPageDataResult<T> =
  | { status: 'loaded'; data: T }
  | { status: 'not-found' }
  | { status: 'unavailable'; error: unknown };

export async function readPublicPageData<T>(read: () => Promise<T | null>): Promise<PublicPageDataResult<T>> {
  try {
    const data = await read();
    return data === null ? { status: 'not-found' } : { status: 'loaded', data };
  } catch (error) {
    return { status: 'unavailable', error };
  }
}

export async function readHomePageData(
  read: () => Promise<HomeInitialData>,
): Promise<{ status: 'loaded'; data: HomeInitialData } | { status: 'unavailable'; error: unknown }> {
  try {
    return { status: 'loaded', data: await read() };
  } catch (error) {
    return { status: 'unavailable', error };
  }
}

export function readCollectionPageData(
  read: () => Promise<HomeInitialData>,
  slug: string,
): Promise<PublicPageDataResult<PublicCollection<HomeTournament>>> {
  return readPublicPageData(async () => {
    const data = await read();
    return data.collections.find((collection) => collection.slug === slug) || null;
  });
}
