import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { Home } from './pages/Home/Home';
import { CreateTournament } from './pages/Create/CreateTournament';
import { TournamentAdmin } from './pages/Admin/TournamentAdmin';
import { TournamentView } from './pages/Public/TournamentView';
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
          <Route path="/t/:slug/admin" element={<TournamentAdmin />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
