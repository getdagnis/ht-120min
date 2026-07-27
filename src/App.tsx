'use client';

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { Home } from './legacy-pages/Home/Home';
import { CreateTournament } from './legacy-pages/Create/CreateTournament';
import { TournamentView } from './legacy-pages/Public/TournamentView';
import { Matchmaker } from './legacy-pages/Public/Matchmaker';
import { SupportersPage } from './legacy-pages/Public/SupportersPage';
import { AuthCallback } from './legacy-pages/AuthCallback';
import { ScrollToTop } from './components/ScrollToTop';
import { TournamentHistoryDummy } from './legacy-pages/Dummies/TournamentHistoryDummy';
function PublicApp() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateTournament />} />
        <Route path="/t/:slug" element={<TournamentView />} />
        <Route path="/matchmaker" element={<Matchmaker />} />
        <Route path="/tinder" element={<Matchmaker />} />
        <Route path="/supporters" element={<SupportersPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        {process.env.NODE_ENV !== 'production' && <Route path="/dummies/tournament-history" element={<TournamentHistoryDummy />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function RoutedApp() {
  return (
    <div>
      <ScrollToTop />
      <PublicApp />
    </div>
  );
}

function App({ basename }: { basename?: string }) {
  return (
    <BrowserRouter basename={basename}>
      <RoutedApp />
    </BrowserRouter>
  );
}

export default App;
