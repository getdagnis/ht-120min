'use client';

import { BrowserRouter, Route, Routes, StaticRouter } from 'react-router-dom';
import { Layout } from '../components/Layout/Layout';
import { ScrollToTop } from '../components/ScrollToTop';
import { TournamentView } from '../legacy-pages/Public/TournamentView';
import { LegacyRouteHandoff } from './LegacyRouteHandoff';
import type { TournamentInitialData } from '../app/_data/public-data';
import type { Locale } from '../i18n/config';

export function TournamentPublicApp({
  locale,
  slug,
  initialData,
}: {
  locale: Locale;
  slug: string;
  initialData?: TournamentInitialData;
}) {
  const content = (
    <>
      <ScrollToTop />
      <Layout>
        <Routes>
          <Route path="/t/:slug" element={<TournamentView initialData={initialData} />} />
          <Route path="*" element={<LegacyRouteHandoff />} />
        </Routes>
      </Layout>
    </>
  );

  if (typeof window === 'undefined') {
    return (
      <StaticRouter basename={`/${locale}`} location={`/${locale}/t/${slug}`}>
        {content}
      </StaticRouter>
    );
  }

  return <BrowserRouter basename={`/${locale}`}>{content}</BrowserRouter>;
}
