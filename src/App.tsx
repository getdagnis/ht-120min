import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { Home } from './pages/Home/Home';
import { CreateTournament } from './pages/Create/CreateTournament';
import { TournamentView } from './pages/Public/TournamentView';
import { Matchmaker } from './pages/Public/Matchmaker';
import { AuthCallback } from './pages/AuthCallback';
import { ScrollToTop } from './components/ScrollToTop';

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateTournament />} />
          <Route path="/t/:slug" element={<TournamentView />} />
          <Route path="/matchmaker" element={<Matchmaker />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
