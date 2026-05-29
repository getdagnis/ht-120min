import React, { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { generateRoundRobin } from '../../utils/scheduler';
import { Trash2, Plus, Play, Save, Copy } from 'lucide-react';
import styles from './TournamentAdmin.module.scss';

export const TournamentAdmin: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const [tournament, setTournament] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState(location.state?.password || localStorage.getItem(`admin_pw_${slug}`) || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<any>({});

  useEffect(() => {
    fetchTournament();
  }, [slug]);

  const fetchTournament = async () => {
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .eq('slug', slug)
      .single();

    if (data) {
      setTournament(data);
      if (password === data.admin_password) {
        setIsAuthenticated(true);
        fetchDetails(data.id);
      }
    }
    setLoading(false);
  };

  const fetchDetails = async (tournamentId: string) => {
    const { data: teamsData } = await supabase
      .from('teams')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: true });
    
    setTeams(teamsData || []);

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
      .eq('tournament_id', tournamentId)
      .order('round_number', { ascending: true });
    
    setRounds(roundsData || []);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (tournament && password === tournament.admin_password) {
      setIsAuthenticated(true);
      localStorage.setItem(`admin_pw_${slug}`, password);
      fetchDetails(tournament.id);
    } else {
      alert('Invalid password');
    }
  };

  const addTeam = async () => {
    if (!newTeamName.trim()) return;
    const { error } = await supabase
      .from('teams')
      .insert([{ tournament_id: tournament.id, name: newTeamName.trim() }]);
    
    if (error) alert(error.message);
    else {
      setNewTeamName('');
      fetchDetails(tournament.id);
    }
  };

  const deleteTeam = async (id: string) => {
    if (rounds.length > 0) return; // Cannot delete after generation
    await supabase.from('teams').delete().eq('id', id);
    fetchDetails(tournament.id);
  };

  const generateSchedule = async () => {
    if (teams.length < 2) {
      alert('Need at least 2 teams');
      return;
    }
    setIsGenerating(true);
    const schedule = generateRoundRobin(teams.map(t => t.id));
    
    for (const roundInfo of schedule) {
      const { data: round } = await supabase
        .from('rounds')
        .insert([{ tournament_id: tournament.id, round_number: roundInfo.roundNumber }])
        .select()
        .single();
      
      if (round) {
        const matchesToInsert = roundInfo.matches.map(m => ({
          round_id: round.id,
          home_team_id: m.home,
          away_team_id: m.away,
          home_goals: null,
          away_goals: null,
          completed: false,
          went_120: false
        }));
        await supabase.from('matches').insert(matchesToInsert);
      }
    }
    
    await fetchDetails(tournament.id);
    setIsGenerating(false);
  };

  const updateMatch = async (matchId: string) => {
    const data = matchData[matchId];
    const { error } = await supabase
      .from('matches')
      .update({
        home_goals: parseInt(data.home_goals),
        away_goals: parseInt(data.away_goals),
        went_120: data.went_120,
        completed: true
      })
      .eq('id', matchId);
    
    if (error) alert(error.message);
    else {
      setEditingMatch(null);
      fetchDetails(tournament.id);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!tournament) return <div>Tournament not found</div>;

  if (!isAuthenticated) {
    return (
      <div className={styles.auth}>
        <Card title="Admin Login">
          <form onSubmit={handleLogin}>
            <div className={styles.field}>
              <label>Admin Password</label>
              <input 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
              />
            </div>
            <Button type="submit" fullWidth>Login</Button>
          </form>
        </Card>
      </div>
    );
  }

  const isGenerated = rounds.length > 0;
  const publicUrl = `${window.location.origin}/t/${slug}`;

  return (
    <div className={styles.admin}>
      <div className={styles.header}>
        <h1>{tournament.name} (Admin)</h1>
        <div className={styles.meta}>
          <div className={styles.metaItem}>
            <span>Public URL:</span>
            <code>{publicUrl}</code>
            <Button size="sm" variant="secondary" onClick={() => {
              navigator.clipboard.writeText(publicUrl);
              alert('Copied to clipboard!');
            }}><Copy size={14} /></Button>
          </div>
          <div className={styles.metaItem}>
            <span>Password:</span>
            <code>{tournament.admin_password}</code>
          </div>
        </div>
      </div>

      {!isGenerated ? (
        <Card title="Manage Teams">
          <div className={styles.teamForm}>
            <input 
              type="text" 
              placeholder="Team name" 
              value={newTeamName} 
              onChange={(e) => setNewTeamName(e.target.value)}
            />
            <Button onClick={addTeam}><Plus size={18} /> Add</Button>
          </div>
          <ul className={styles.teamList}>
            {teams.map(team => (
              <li key={team.id}>
                {team.name}
                <button onClick={() => deleteTeam(team.id)} className={styles.deleteBtn}>
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.genActions}>
            <Button 
              variant="primary" 
              size="lg" 
              onClick={generateSchedule} 
              disabled={teams.length < 2 || isGenerating}
            >
              <Play size={18} /> Generate Schedule
            </Button>
            <p><small>Once generated, you cannot add or remove teams.</small></p>
          </div>
        </Card>
      ) : (
        <div className={styles.rounds}>
          <h2>Fixtures & Results</h2>
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

                    {editingMatch === match.id ? (
                      <div className={styles.matchEdit}>
                        <div className={styles.scoreInputs}>
                          <input 
                            type="number" 
                            placeholder="Home" 
                            value={matchData[match.id]?.home_goals ?? match.home_goals ?? ''} 
                            onChange={(e) => setMatchData({
                              ...matchData,
                              [match.id]: { ...(matchData[match.id] || match), home_goals: e.target.value }
                            })}
                          />
                          <span>-</span>
                          <input 
                            type="number" 
                            placeholder="Away" 
                            value={matchData[match.id]?.away_goals ?? match.away_goals ?? ''} 
                            onChange={(e) => setMatchData({
                              ...matchData,
                              [match.id]: { ...(matchData[match.id] || match), away_goals: e.target.value }
                            })}
                          />
                        </div>
                        <label className={styles.checkboxLabel}>
                          <input 
                            type="checkbox" 
                            checked={matchData[match.id]?.went_120 ?? match.went_120 ?? false}
                            onChange={(e) => setMatchData({
                              ...matchData,
                              [match.id]: { ...(matchData[match.id] || match), went_120: e.target.checked }
                            })}
                          />
                          Reached 120m
                        </label>
                        <div className={styles.editActions}>
                          <Button size="sm" onClick={() => updateMatch(match.id)}><Save size={14}/> Save</Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditingMatch(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.matchResult}>
                        {match.completed ? (
                          <div className={styles.resultInfo}>
                            <span className={styles.score}>{match.home_goals} - {match.away_goals}</span>
                            {match.went_120 && <span className={styles.badge}>120m</span>}
                            <Button size="sm" variant="secondary" onClick={() => {
                              setEditingMatch(match.id);
                              setMatchData({ ...matchData, [match.id]: match });
                            }}>Edit</Button>
                          </div>
                        ) : (
                          <Button size="sm" onClick={() => {
                            setEditingMatch(match.id);
                            setMatchData({ ...matchData, [match.id]: { ...match, home_goals: '', away_goals: '' } });
                          }}>Enter Result</Button>
                        )}
                      </div>
                    )}
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
