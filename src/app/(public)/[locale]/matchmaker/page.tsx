import { redirect } from 'next/navigation';

export default async function MatchmakerAlias({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const search = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, item));
    } else if (value !== undefined) {
      search.set(key, value);
    }
  });

  const queryString = search.toString();
  redirect(`/${locale}/tinder${queryString ? `?${queryString}` : ''}`);
}
