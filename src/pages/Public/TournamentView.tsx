import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Card } from '../../components/Card/Card';
import { calculateStandings } from '../../utils/standings';
import type { TeamStanding } from '../../utils/standings';
import styles from './TournamentView.module.scss';

export const TournamentView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [tournament, setTournament] = useState<any>(null);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'standings' | 'fixtures'>('standings');

  useEffect(() => {
    fetchData();
  }, [slug]);

  const fetchData = async () => {
    const { data: tournamentData } = await supabase
      .from('tournaments')
      .select('*')
      .eq('slug', slug)
      .single();

    if (tournamentData) {
      setTournament(tournamentData);
      
      const { data: teamsData } = await supabase
        .from('teams')
        .select('*')
        .eq('tournament_id', tournamentData.id);

      const { data: roundsData } = await supabase
        .from('rounds')
        .select(`
          *,
          matches (
            *,
            home_team:teams!matches_home_team_id_fkey(name),
            away_team:teams!matches_away_team_id_fkey(name)
          )
        `)
        .eq('tournament_id', tournamentData.id)
        .order('round_number', { ascending: true });

      if (teamsData && roundsData) {
        const allMatches = roundsData.flatMap(r => r.matches);
        const calculated = calculateStandings(
          teamsData.map(t => ({ id: t.id, name: t.name })),
          allMatches,
          tournamentData.scoring_mode as any
        );
        setStandings(calculated);
        setRounds(roundsData);
      }
    }
    setLoading(false);
  };

  if (loading) return <div>Loading...</div>;
  if (!tournament) return <div>Tournament not found</div>;

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1>{tournament.name}</h1>
        <div className={styles.description}>
          {tournament.scoring_mode === '120m' ? (
            <p>
              <strong>120m Training Mode:</strong> Teams compete primarily on matches where 120 minutes of training was achieved. 
              Standings are ranked by <strong>120m Achievements</strong>. Ties are settled by standard victory points, goal difference, and goals scored.
            </p>
          ) : (
            <p>
              <strong>Victory Points Mode:</strong> Standard competitive tournament. 
              Teams earn 3 points for a win and 1 point for a draw. Standings are ranked by <strong>Total Points</strong>, then goal difference and goals scored.
            </p>
          )}
        </div>
      </header>

      <div className={styles.tabs}>
        <button 
          className={activeTab === 'standings' ? styles.active : ''} 
          onClick={() => setActiveTab('standings')}
        >
          Standings
        </button>
        <button 
          className={activeTab === 'fixtures' ? styles.active : ''} 
          onClick={() => setActiveTab('fixtures')}
        >
          Fixtures & Results
        </button>
      </div>

      {activeTab === 'standings' ? (
        <Card title="Standings">
          <div className={styles.tableWrapper}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  {tournament.scoring_mode === '120m' && <th>120m</th>}
                  <th>Pld</th>
                  <th>W</th>
                  <th>D</th>
                  <th>L</th>
                  <th>GD</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, idx) => (
                  <tr key={s.teamId}>
                    <td>{idx + 1}</td>
                    <td className={styles.teamNameCell}>{s.teamName}</td>
                    {tournament.scoring_mode === '120m' && (
                      <td className={styles.highlight}>{s.achievements120m}</td>
                    )}
                    <td>{s.played}</td>
                    <td>{s.won}</td>
                    <td>{s.drawn}</td>
                    <td>{s.lost}</td>
                    <td>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                    <td className={tournament.scoring_mode === 'points' ? styles.highlight : ''}>
                      {s.pts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className={styles.rounds}>
          {rounds.map(round => (
            <Card key={round.id} title={`Round ${round.round_number}`}>
              <div className={styles.matches}>
                {round.matches.map((match: any) => (
                  <div key={match.id} className={styles.match}>
                    <div className={styles.matchTeams}>
                      <span className={styles.teamName}>{match.home_team.name}</span>
                      <span className={styles.vs}>vs</span>
                      <span className={styles.teamName}>{match.away_team.name}</span>
                    </div>
                    <div className={styles.result}>
                      {match.completed ? (
                        <div className={styles.scoreRow}>
                          <span className={styles.score}>{match.home_goals} - {match.away_goals}</span>
                          {match.went_120 && <span className={styles.badge}>120m</span>}
                        </div>
                      ) : (
                        <span className={styles.pending}>Pending</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
