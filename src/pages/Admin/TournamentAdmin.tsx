import React, { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { generateRoundRobin } from '../../utils/scheduler';
import { Trash2, Plus, Play, Save, Copy, RefreshCw, XCircle } from 'lucide-react';
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

  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'single' | 'double'>('single');

  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<any>({});

  const [replacingTeamId, setReplacingTeamId] = useState<string | null>(null);
  const [replacementHtId, setReplacementHtId] = useState('');
  const [replacementName, setReplacementName] = useState('');

  useEffect(() => {
    fetchTournament();
  }, [slug]);

  const fetchTournament = async () => {
    const { data } = await supabase.from('tournaments').select('*').eq('slug', slug).single();

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
      .select(
        `
        *,
        matches (
          *,
          home_team:teams!matches_home_team_id_fkey(name, ht_team_id, active),
          away_team:teams!matches_away_team_id_fkey(name, ht_team_id, active)
        )
      `,
      )
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

  const addTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newTeamId.trim()) {
      alert('Both Team Name and HT ID are required.');
      return;
    }
    setIsSavingTeam(true);
    try {
      const { error } = await supabase.from('teams').insert([
        {
          tournament_id: tournament.id,
          name: newTeamName.trim(),
          ht_team_id: parseInt(newTeamId.trim()),
          active: true,
        },
      ]);

      if (error) throw error;
      setNewTeamId('');
      setNewTeamName('');
      fetchDetails(tournament.id);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const replaceTeam = async (oldTeamId: string) => {
    if (!replacementName.trim() || !replacementHtId.trim()) {
      alert('Both new Team Name and new HT ID are required.');
      return;
    }
    setIsSavingTeam(true);
    try {
      await supabase.from('teams').update({ active: false }).eq('id', oldTeamId);
      const { error } = await supabase.from('teams').insert([
        {
          tournament_id: tournament.id,
          name: replacementName.trim(),
          ht_team_id: parseInt(replacementHtId.trim()),
          active: true,
          replacement_for_team_id: oldTeamId,
        },
      ]);

      if (error) throw error;
      setReplacingTeamId(null);
      setReplacementHtId('');
      setReplacementName('');
      fetchDetails(tournament.id);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const deactivateTeam = async (id: string) => {
    if (window.confirm('Are you sure you want to deactivate this team?')) {
      await supabase.from('teams').update({ active: false }).eq('id', id);
      fetchDetails(tournament.id);
    }
  };

  const deleteTeam = async (id: string) => {
    if (rounds.length > 0) {
      deactivateTeam(id);
      return;
    }
    await supabase.from('teams').delete().eq('id', id);
    fetchDetails(tournament.id);
  };

  const regenerateSchedule = async () => {
    if (!window.confirm('Are you sure you want to regenerate the schedule? All current results will be lost!')) {
      return;
    }
    setIsGenerating(true);
    try {
      const { error } = await supabase.from('rounds').delete().eq('tournament_id', tournament.id);

      if (error) throw error;
      await fetchDetails(tournament.id);
    } catch (err: any) {
      alert('Error regenerating: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const generateSchedule = async () => {
    const activeTeams = teams.filter((t) => t.active);
    if (activeTeams.length < 2) {
      alert('Need at least 2 active teams');
      return;
    }
    setIsGenerating(true);

    // Using the new scheduler
    const schedule = generateRoundRobin(
      activeTeams.map((t) => t.id),
      {
        mode: scheduleMode,
        neutralInSingle: true,
      },
    );

    try {
      for (const roundInfo of schedule) {
        const { data: round, error: rError } = await supabase
          .from('rounds')
          .insert([{ tournament_id: tournament.id, round_number: roundInfo.roundNumber }])
          .select()
          .single();

        if (rError) throw rError;

        if (round) {
          const matchesToInsert = roundInfo.matches
            .filter((m) => !m.isBye)
            .map((m) => ({
              round_id: round.id,
              home_team_id: m.home,
              away_team_id: m.away,
              home_goals: null,
              away_goals: null,
              completed: false,
              went_120: false,
              venue_type: m.venueType,
            }));

          if (matchesToInsert.length > 0) {
            const { error: mError } = await supabase.from('matches').insert(matchesToInsert);
            if (mError) throw mError;
          }
        }
      }
      await fetchDetails(tournament.id);
    } catch (err: any) {
      alert('Error generating schedule: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const updateMatch = async (matchId: string) => {
    const data = matchData[matchId];
    const { error } = await supabase
      .from('matches')
      .update({
        home_goals: parseInt(data.home_goals),
        away_goals: parseInt(data.away_goals),
        went_120: data.went_120,
        completed: true,
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
                name="admin_password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" fullWidth>
              Login
            </Button>
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
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                alert('Copied to clipboard!');
              }}
            >
              <Copy size={14} />
            </Button>
          </div>
          <div className={styles.metaItem}>
            <span>Password:</span>
            <code>{tournament.admin_password}</code>
          </div>
        </div>
      </div>

      <Card title="Manage Teams">
        <form onSubmit={addTeam} className={styles.teamForm}>
          <div className={styles.inputGroup}>
            <input
              name="team_ht_id"
              type="number"
              placeholder="HT Team ID"
              value={newTeamId}
              onChange={(e) => setNewTeamId(e.target.value)}
              required
            />
            <input
              name="team_name"
              type="text"
              placeholder="Team Name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={isSavingTeam}>
            {isSavingTeam ? (
              'Saving...'
            ) : (
              <>
                <Plus size={18} /> Add Team
              </>
            )}
          </Button>
        </form>

        <ul className={styles.teamList}>
          {teams.map((team) => (
            <li key={team.id} className={!team.active ? styles.inactiveTeam : ''}>
              <div className={styles.teamInfo}>
                <span className={styles.name}>{team.name}</span>
                {team.ht_team_id && <span className={styles.id}>ID: {team.ht_team_id}</span>}
                {!team.active && <span className={styles.statusBadge}>Inactive</span>}
              </div>

              <div className={styles.teamActions}>
                {team.active && (
                  <>
                    {replacingTeamId === team.id ? (
                      <div className={styles.inlineReplace}>
                        <input
                          name={`replace_id_${team.id}`}
                          type="number"
                          placeholder="New HT ID"
                          value={replacementHtId}
                          onChange={(e) => setReplacementHtId(e.target.value)}
                          required
                        />
                        <input
                          name={`replace_name_${team.id}`}
                          type="text"
                          placeholder="New Name"
                          value={replacementName}
                          onChange={(e) => setReplacementName(e.target.value)}
                          required
                        />
                        <Button size="sm" onClick={() => replaceTeam(team.id)} disabled={isSavingTeam}>
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setReplacingTeamId(null);
                            setReplacementHtId('');
                            setReplacementName('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setReplacingTeamId(team.id)}>
                        <RefreshCw size={14} /> Replace
                      </Button>
                    )}
                    <button onClick={() => deleteTeam(team.id)} className={styles.deleteBtn}>
                      {isGenerated ? <XCircle size={18} /> : <Trash2 size={18} />}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>

        {!isGenerated ? (
          <div className={styles.genOptions}>
            <div className={styles.checkboxGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="radio"
                  name="scheduleMode"
                  checked={scheduleMode === 'single'}
                  onChange={() => setScheduleMode('single')}
                />
                Play each other once (Neutral stadium)
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="radio"
                  name="scheduleMode"
                  checked={scheduleMode === 'double'}
                  onChange={() => setScheduleMode('double')}
                />
                Play each other twice (Home and Away)
              </label>
            </div>
            <Button
              variant="primary"
              size="lg"
              onClick={generateSchedule}
              disabled={teams.filter((t) => t.active).length < 2 || isGenerating}
            >
              <Play size={18} /> Generate Schedule
            </Button>
          </div>
        ) : (
          <div className={styles.genActions}>
            <Button variant="outline" onClick={regenerateSchedule} disabled={isGenerating}>
              <RefreshCw size={18} /> Regenerate Schedule
            </Button>
          </div>
        )}
      </Card>

      {isGenerated && (
        <div className={styles.rounds}>
          <h2>Fixtures & Results</h2>
          {rounds.map((round) => (
            <Card key={round.id} title={`Round ${round.round_number}`}>
              <div className={styles.matches}>
                {round.matches.map((match: any) => {
                  return (
                    <div key={match.id} className={styles.match}>
                      <div className={styles.matchTeams}>
                        <div className={styles.teamCol}>
                          <span className={styles.teamName}>{match.home_team.name}</span>
                          <span className={styles.teamId}>({match.home_team.ht_team_id})</span>
                        </div>
                        <span className={styles.vs}>vs</span>
                        <div className={styles.teamCol}>
                          <span className={styles.teamName}>{match.away_team.name}</span>
                          <span className={styles.teamId}>({match.away_team.ht_team_id})</span>
                        </div>
                      </div>

                      {editingMatch === match.id ? (
                        <div className={styles.matchEdit}>
                          <div className={styles.scoreInputs}>
                            <input
                              name={`score_home_${match.id}`}
                              type="number"
                              placeholder="Home"
                              value={matchData[match.id]?.home_goals ?? match.home_goals ?? ''}
                              onChange={(e) =>
                                setMatchData({
                                  ...matchData,
                                  [match.id]: { ...(matchData[match.id] || match), home_goals: e.target.value },
                                })
                              }
                            />
                            <span>-</span>
                            <input
                              name={`score_away_${match.id}`}
                              type="number"
                              placeholder="Away"
                              value={matchData[match.id]?.away_goals ?? match.away_goals ?? ''}
                              onChange={(e) =>
                                setMatchData({
                                  ...matchData,
                                  [match.id]: { ...(matchData[match.id] || match), away_goals: e.target.value },
                                })
                              }
                            />
                          </div>
                          <label className={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={matchData[match.id]?.went_120 ?? match.went_120 ?? false}
                              onChange={(e) =>
                                setMatchData({
                                  ...matchData,
                                  [match.id]: { ...(matchData[match.id] || match), went_120: e.target.checked },
                                })
                              }
                            />
                            Reached 120m
                          </label>
                          <div className={styles.editActions}>
                            <Button size="sm" onClick={() => updateMatch(match.id)}>
                              <Save size={14} /> Save
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditingMatch(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.matchResult}>
                          {match.completed ? (
                            <div className={styles.resultInfo}>
                              <span className={styles.score}>
                                {match.home_goals} - {match.away_goals}
                              </span>
                              {match.went_120 && <span className={styles.badge}>120m</span>}
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setEditingMatch(match.id);
                                  setMatchData({ ...matchData, [match.id]: match });
                                }}
                              >
                                Edit
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => {
                                setEditingMatch(match.id);
                                setMatchData({
                                  ...matchData,
                                  [match.id]: { ...match, home_goals: '', away_goals: '' },
                                });
                              }}
                            >
                              Enter Result
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
