'use client';

import { BrowserRouter, Route, Routes, StaticRouter } from 'react-router-dom';
import { Layout } from '../components/Layout/Layout';
import { ScrollToTop } from '../components/ScrollToTop';
import { Home } from '../legacy-pages/Home/Home';
import { LegacyRouteHandoff } from './LegacyRouteHandoff';
import type { HomeInitialData } from '../app/_data/public-data';
import type { Locale } from '../i18n/config';

export function HomePublicApp({ locale, initialData }: { locale: Locale; initialData: HomeInitialData }) {
  const content = (
    <>
      <ScrollToTop />
      <Layout>
        <Routes>
          <Route path="/" element={<Home initialData={initialData} />} />
          <Route path="*" element={<LegacyRouteHandoff />} />
        </Routes>
      </Layout>
    </>
  );

  if (typeof window === 'undefined') {
    return (
      <StaticRouter basename={`/${locale}`} location={`/${locale}`}>
        {content}
      </StaticRouter>
    );
  }

  return <BrowserRouter basename={`/${locale}`}>{content}</BrowserRouter>;
}
