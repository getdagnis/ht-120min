import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { Home } from './pages/Home/Home';
import { CreateTournament } from './pages/Create/CreateTournament';
import { TournamentView } from './pages/Public/TournamentView';
import { Matchmaker } from './pages/Public/Matchmaker';
import { SupportersPage } from './pages/Public/SupportersPage';
import { AuthCallback } from './pages/AuthCallback';
import { ScrollToTop } from './components/ScrollToTop';
import { ForgePage } from './pages/Forge/ForgePage';
import { TournamentHistoryDummy } from './pages/Dummies/TournamentHistoryDummy';

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
        {import.meta.env.DEV && <Route path="/dummies/tournament-history" element={<TournamentHistoryDummy />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function RoutedApp() {
  const location = useLocation();

  return (
    <div className={location.pathname.startsWith('/forge') ? 'appRouteForge' : undefined}>
      <ScrollToTop />
      <Routes>
        <Route path="/forge/*" element={<ForgePage />} />
        <Route path="/testing" element={<Navigate to="/forge/testing" replace />} />
        <Route path="/*" element={<PublicApp />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <RoutedApp />
    </BrowserRouter>
  );
}

export default App;
