import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { Home } from './pages/Home/Home';
import { CreateTournament } from './pages/Create/CreateTournament';
import { TournamentView } from './pages/Public/TournamentView';
import { Matchmaker } from './pages/Public/Matchmaker';
import { SupportersPage } from './pages/Public/SupportersPage';
import { AuthCallback } from './pages/AuthCallback';
import { ScrollToTop } from './components/ScrollToTop';
import { ForgePage } from './pages/Forge/ForgePage';

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/forge/*" element={<ForgePage />} />
        <Route path="/testing" element={<Navigate to="/forge/testing" replace />} />
        <Route path="/*" element={<PublicApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
