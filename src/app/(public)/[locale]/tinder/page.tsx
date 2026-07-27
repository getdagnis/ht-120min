import { redirect } from 'next/navigation';

export default async function TinderAlias({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/matchmaker`);
}
