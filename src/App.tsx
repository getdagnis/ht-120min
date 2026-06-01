import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { Home } from './pages/Home/Home';
import { CreateTournament } from './pages/Create/CreateTournament';
import { TournamentView } from './pages/Public/TournamentView';
import { OAuthTeamSelect } from './pages/Public/OAuthTeamSelect';
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
          <Route path="/oauth/select/:token" element={<OAuthTeamSelect />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
