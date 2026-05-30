import React, { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Card } from '../../components/Card/Card';
import { Button } from '../../components/Button/Button';
import { calculateStandings } from '../../utils/standings';
import type { TeamStanding } from '../../utils/standings';
import { generateRoundRobin } from '../../utils/scheduler';
import { LogIn, ExternalLink, Plus, Trash2, RefreshCw, XCircle, Play, Save, Copy, ShieldCheck } from 'lucide-react';
import styles from './TournamentView.module.scss';
import adminStyles from '../Admin/TournamentAdmin.module.scss';

interface MatchWithTeams {
  id: string;
  round_id: string;
  home_team_id: string;
  away_team_id: string;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  home_team: { name: string; ht_team_id: number; active: boolean };
  away_team: { name: string; ht_team_id: number; active: boolean };
}

export const TournamentView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const [tournament, setTournament] = useState<any>(null);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'standings' | 'fixtures' | 'admin'>(
    location.state?.isAdminInit ? 'admin' : 'standings',
  );

  // Admin states
  const [password, setPassword] = useState(localStorage.getItem(`admin_pw_${slug}`) || '');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'single' | 'double'>('double');
  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<any>({});
  const [replacingTeamId, setReplacingTeamId] = useState<string | null>(null);
  const [replacementHtId, setReplacementHtId] = useState('');
  const [replacementName, setReplacementName] = useState('');

  // Join states
  const [isJoining, setIsJoining] = useState(false);
  const [joinTeamId, setJoinTeamId] = useState('');
  const [joinTeamName, setJoinTeamName] = useState('');

  useEffect(() => {
    fetchData();
  }, [slug]);

  useEffect(() => {
    if (location.state?.isAdminInit) {
      setActiveTab('admin');
    }
  }, [location.state?.isAdminInit]);

  const fetchData = async () => {
    const { data: tournamentData } = await supabase.from('tournaments').select('*').eq('slug', slug).single();

    if (tournamentData) {
      setTournament(tournamentData);

      const { data: teamsData } = await supabase
        .from('teams')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .order('created_at', { ascending: true });

      setTeams(teamsData || []);

      const { data: roundsData } = await supabase
        .from('rounds')
        .select('*')
        .eq('tournament_id', tournamentData.id)
        .order('round_number', { ascending: true });

      const { data: matchesData } = await supabase
        .from('matches')
        .select(
          `
          *,
          home_team:teams!matches_home_team_id_fkey(name, ht_team_id, logo_url, country_name, active),
          away_team:teams!matches_away_team_id_fkey(name, ht_team_id, logo_url, country_name, active)
        `,
        )
        .in(
          'round_id',
          (roundsData || []).map((r) => r.id),
        );

      if (teamsData) {
        const matchesWithTeams = matchesData || [];
        const calculated = calculateStandings(
          teamsData.map((t) => ({
            id: t.id,
            name: t.name,
            ht_team_id: t.ht_team_id,
            active: t.active,
            replacement_for_team_id: t.replacement_for_team_id,
          })),
          matchesWithTeams,
          tournamentData.scoring_mode as any,
        );
        setStandings(calculated);

        if (roundsData) {
          const roundsWithMatches = roundsData.map((r) => ({
            ...r,
            matches: matchesWithTeams.filter((m) => m.round_id === r.id),
          }));
          setRounds(roundsWithMatches);
        }
      }

      if (password === tournamentData.admin_password) {
        setIsAdminAuthenticated(true);
      }
    }
    setLoading(false);
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (tournament && password === tournament.admin_password) {
      setIsAdminAuthenticated(true);
      localStorage.setItem(`admin_pw_${slug}`, password);
    } else {
      alert('Invalid password');
    }
  };

  const addTeam = async (e: React.FormEvent, isJoin: boolean = false) => {
    if (e) e.preventDefault();
    const name = isJoin ? joinTeamName : newTeamName;
    const htId = isJoin ? joinTeamId : newTeamId;

    if (!name.trim() || !htId.trim()) {
      alert('Both Team Name and HT ID are required.');
      return;
    }

    setIsSavingTeam(true);
    try {
      const { error } = await supabase.from('teams').insert([
        {
          tournament_id: tournament.id,
          name: name.trim(),
          ht_team_id: parseInt(htId.trim()),
          active: true,
        },
      ]);

      if (error) throw error;
      if (isJoin) {
        setJoinTeamId('');
        setJoinTeamName('');
        setIsJoining(false);
      } else {
        setNewTeamId('');
        setNewTeamName('');
      }
      fetchData();
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
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const deleteTeam = async (id: string) => {
    if (rounds.length > 0) {
      if (window.confirm('Are you sure you want to deactivate this team?')) {
        await supabase.from('teams').update({ active: false }).eq('id', id);
        fetchData();
      }
      return;
    }
    await supabase.from('teams').delete().eq('id', id);
    fetchData();
  };

  const generateSchedule = async () => {
    const activeTeams = teams.filter((t) => t.active);
    if (activeTeams.length < 2) {
      alert('Need at least 2 active teams');
      return;
    }
    setIsGenerating(true);

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
      fetchData();
    } catch (err: any) {
      alert('Error generating schedule: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateSchedule = async () => {
    if (!window.confirm('Are you sure you want to regenerate the schedule? All current results will be lost!')) {
      return;
    }
    setIsGenerating(true);
    try {
      await supabase.from('rounds').delete().eq('tournament_id', tournament.id);
      fetchData();
    } catch (err: any) {
      alert('Error regenerating: ' + err.message);
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
      fetchData();
    }
  };

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!tournament) return <div className={styles.loading}>Tournament not found</div>;

  const isGenerated = rounds.length > 0;
  const is120minMode = tournament.scoring_mode === '120m' || tournament.scoring_mode === '120min';

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <h1>{tournament.name}</h1>
          <div className={styles.headerActions}>
            {!isGenerated && !isJoining && (
              <Button onClick={() => setIsJoining(true)} variant="primary">
                <LogIn size={18} /> Join Tournament
              </Button>
            )}
          </div>
        </div>

        {isJoining && !isGenerated && (
          <div style={{ marginBottom: '2rem' }}>
            <Card variant="hero" title="Register Your Team">
              <form onSubmit={(e) => addTeam(e, true)} className={styles.joinForm}>
                <div className={styles.joinInputs}>
                  <input
                    type="number"
                    placeholder="HT Team ID"
                    value={joinTeamId}
                    onChange={(e) => setJoinTeamId(e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    placeholder="Team Name"
                    value={joinTeamName}
                    onChange={(e) => setJoinTeamName(e.target.value)}
                    required
                  />
                </div>
                <div className={styles.joinActions}>
                  <Button type="submit" variant="secondary" disabled={isSavingTeam}>
                    {isSavingTeam ? 'Joining...' : 'Confirm Join'}
                  </Button>
                  <Button variant="secondary" onClick={() => setIsJoining(false)} style={{ opacity: 0.8 }}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        <div className={styles.description}>
          {/* user written descriptions: do not change */}
          {is120minMode ? (
            <p>
              <strong>120min training mode:</strong> Teams in this tournament compete to achieve more 120min training
              matches achieved. Standings are ranked by <strong>120min achievements</strong>. Ties are settled by
              standard victory points, goal difference, and goals scored.
            </p>
          ) : (
            <p>
              <strong>Victory points mode:</strong> Standard competitive tournament. Teams earn 3 points for a win and 1
              point for a draw. Standings are ranked by <strong>Total Points</strong>, then goal difference and goals
              scored. 120min games mean nothing here.
            </p>
          )}
        </div>
      </header>

      <div className={styles.tabs}>
        <button className={activeTab === 'standings' ? styles.active : ''} onClick={() => setActiveTab('standings')}>
          Standings
        </button>
        <button className={activeTab === 'fixtures' ? styles.active : ''} onClick={() => setActiveTab('fixtures')}>
          Fixtures & Results
        </button>
        <button className={activeTab === 'admin' ? styles.active : ''} onClick={() => setActiveTab('admin')}>
          Admin
        </button>
      </div>

      {activeTab === 'standings' && (
        <Card title="Standings" variant="classic">
          <div className={styles.tableWrapper}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  {is120minMode && <th className={styles.center}>120min</th>}
                  <th className={styles.center}>Pld</th>
                  <th className={styles.center}>W</th>
                  <th className={styles.center}>D</th>
                  <th className={styles.center}>L</th>
                  <th className={styles.center}>GD</th>
                  <th className={styles.center}>Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, idx) => (
                  <tr key={s.teamId}>
                    <td className={styles.muted}>{idx + 1}</td>
                    <td className={styles.teamNameCell}>
                      <div className={styles.teamInfo}>
                        <div className={styles.nameRow}>
                          <span className={styles.teamName}>{s.teamName}</span>
                          <a
                            href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${s.htTeamId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.htLink}
                          >
                            <ExternalLink size={12} />
                          </a>
                        </div>
                        {s.htTeamId && <span className={styles.teamId}>ID: {s.htTeamId}</span>}
                      </div>
                    </td>
                    {is120minMode && <td className={`${styles.highlight} ${styles.center}`}>{s.achievements120min}</td>}
                    <td className={styles.center}>{s.played}</td>
                    <td className={styles.center}>{s.won}</td>
                    <td className={styles.center}>{s.drawn}</td>
                    <td className={styles.center}>{s.lost}</td>
                    <td className={styles.center}>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                    <td className={`${!is120minMode ? styles.highlight : ''} ${styles.center}`}>{s.pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'fixtures' && (
        <div className={styles.rounds}>
          {rounds.map((round) => (
            <Card key={round.id} title={`Round ${round.round_number}`} variant="classic">
              <div className={styles.matches}>
                {round.matches.map((match: any) => (
                  <div key={match.id} className={styles.match}>
                    <div className={styles.matchTeams}>
                      <div className={styles.teamDisplay}>
                        <span className={styles.teamName}>{match.home_team.name}</span>
                        {match.home_team.ht_team_id && (
                          <span className={styles.teamId}>({match.home_team.ht_team_id})</span>
                        )}
                      </div>
                      <span className={styles.vs}>vs</span>
                      <div className={styles.teamDisplay}>
                        <span className={styles.teamName}>{match.away_team.name}</span>
                        {match.away_team.ht_team_id && (
                          <span className={styles.teamId}>({match.away_team.ht_team_id})</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.result}>
                      {match.completed ? (
                        <div className={styles.scoreRow}>
                          <span className={styles.score}>
                            {match.home_goals} - {match.away_goals}
                          </span>
                          {match.went_120 && <span className={styles.badge}>120min</span>}
                        </div>
                      ) : (
                        <span className={styles.pending}>Scheduled</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'admin' && (
        <div className={styles.adminSection}>
          {!isAdminAuthenticated ? (
            <Card variant="classic" title="Admin Access">
              <form onSubmit={handleAdminLogin} className={styles.adminAuthForm}>
                <div className={styles.authField}>
                  <label>Tournament Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter admin password"
                    required
                  />
                </div>
                <Button type="submit" variant="primary">
                  <ShieldCheck size={18} /> Authenticate
                </Button>
              </form>
            </Card>
          ) : (
            <div className={adminStyles.admin}>
              <div className={adminStyles.mainGrid}>
                <section className={adminStyles.teamsSection}>
                  <Card title="Teams Management" variant="classic">
                    <form onSubmit={(e) => addTeam(e, false)} className={adminStyles.teamForm}>
                      <div className={adminStyles.inputGroup}>
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
                      <Button type="submit" disabled={isSavingTeam} variant="primary">
                        {isSavingTeam ? (
                          'Saving...'
                        ) : (
                          <>
                            <Plus size={18} /> Add Team
                          </>
                        )}
                      </Button>
                    </form>

                    <ul className={adminStyles.teamList}>
                      {teams.map((team) => (
                        <li key={team.id} className={!team.active ? adminStyles.inactiveTeam : ''}>
                          <div className={adminStyles.teamInfo}>
                            <span className={adminStyles.name}>{team.name}</span>
                            {team.ht_team_id && <span className={adminStyles.id}>ID: {team.ht_team_id}</span>}
                            {!team.active && <span className={adminStyles.statusBadge}>Inactive</span>}
                          </div>

                          <div className={adminStyles.teamActions}>
                            {team.active && (
                              <>
                                {replacingTeamId === team.id ? (
                                  <div className={adminStyles.inlineReplace}>
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
                                    <div className={adminStyles.replaceActions}>
                                      <Button
                                        size="sm"
                                        onClick={() => replaceTeam(team.id)}
                                        disabled={isSavingTeam}
                                        variant="primary"
                                      >
                                        Save
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
                                        <XCircle size={16} />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button size="sm" variant="outline" onClick={() => setReplacingTeamId(team.id)}>
                                    <RefreshCw size={14} /> Replace
                                  </Button>
                                )}
                                <button onClick={() => deleteTeam(team.id)} className={adminStyles.deleteBtn}>
                                  {isGenerated ? <XCircle size={20} /> : <Trash2 size={20} />}
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className={adminStyles.scheduleControl}>
                      {!isGenerated ? (
                        <div className={adminStyles.genOptions}>
                          <div className={adminStyles.checkboxGroup}>
                            <label className={adminStyles.checkboxLabel}>
                              <input
                                type="radio"
                                name="scheduleMode"
                                checked={scheduleMode === 'single'}
                                onChange={() => setScheduleMode('single')}
                              />
                              Play each other once (Neutral stadium)
                            </label>
                            <label className={adminStyles.checkboxLabel}>
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
                            fullWidth
                            onClick={generateSchedule}
                            disabled={teams.filter((t) => t.active).length < 2 || isGenerating}
                          >
                            <Play size={18} /> Generate Schedule
                          </Button>
                        </div>
                      ) : (
                        <div className={adminStyles.genActions}>
                          <div className={adminStyles.meta} style={{ marginBottom: '1.5rem' }}>
                            <div className={adminStyles.metaItem}>
                              <span className={adminStyles.label}>Public URL:</span>
                              <code>{publicUrl}</code>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  navigator.clipboard.writeText(publicUrl);
                                  alert('Copied!');
                                }}
                              >
                                <Copy size={14} />
                              </Button>
                            </div>
                            <div className={adminStyles.metaItem}>
                              <span className={adminStyles.label}>Password:</span>
                              <code>{tournament.admin_password}</code>
                            </div>
                          </div>
                          <Button variant="outline" onClick={regenerateSchedule} disabled={isGenerating} fullWidth>
                            <RefreshCw size={18} /> Regenerate Schedule
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                </section>

                {isGenerated && (
                  <section className={adminStyles.fixturesSection}>
                    <div className={adminStyles.fixturesHeader}>
                      <h2>Results Entry</h2>
                    </div>
                    {rounds.map((round) => (
                      <Card key={round.id} title={`Round ${round.round_number}`} variant="classic">
                        <div className={adminStyles.matches}>
                          {round.matches.map((match: MatchWithTeams) => {
                            return (
                              <div key={match.id} className={adminStyles.match}>
                                <div className={adminStyles.matchTeams}>
                                  <div className={adminStyles.teamCol}>
                                    <span className={adminStyles.teamName}>{match.home_team.name}</span>
                                    <span className={adminStyles.teamId}>({match.home_team.ht_team_id})</span>
                                  </div>
                                  <span className={adminStyles.vs}>vs</span>
                                  <div className={adminStyles.teamCol}>
                                    <span className={adminStyles.teamName}>{match.away_team.name}</span>
                                    <span className={adminStyles.teamId}>({match.away_team.ht_team_id})</span>
                                  </div>
                                </div>

                                {editingMatch === match.id ? (
                                  <div className={adminStyles.matchEdit}>
                                    <div className={adminStyles.scoreInputs}>
                                      <input
                                        name={`score_home_${match.id}`}
                                        type="number"
                                        placeholder="H"
                                        value={matchData[match.id]?.home_goals ?? match.home_goals ?? ''}
                                        onChange={(e) =>
                                          setMatchData({
                                            ...matchData,
                                            [match.id]: {
                                              ...(matchData[match.id] || match),
                                              home_goals: e.target.value,
                                            },
                                          })
                                        }
                                      />
                                      <span className={adminStyles.divider}>-</span>
                                      <input
                                        name={`score_away_${match.id}`}
                                        type="number"
                                        placeholder="A"
                                        value={matchData[match.id]?.away_goals ?? match.away_goals ?? ''}
                                        onChange={(e) =>
                                          setMatchData({
                                            ...matchData,
                                            [match.id]: {
                                              ...(matchData[match.id] || match),
                                              away_goals: e.target.value,
                                            },
                                          })
                                        }
                                      />
                                    </div>
                                    <label className={adminStyles.went120}>
                                      <input
                                        type="checkbox"
                                        checked={matchData[match.id]?.went_120 ?? match.went_120 ?? false}
                                        onChange={(e) =>
                                          setMatchData({
                                            ...matchData,
                                            [match.id]: {
                                              ...(matchData[match.id] || match),
                                              went_120: e.target.checked,
                                            },
                                          })
                                        }
                                      />
                                      120min
                                    </label>
                                    <div className={adminStyles.editActions}>
                                      <Button size="sm" onClick={() => updateMatch(match.id)} variant="primary">
                                        <Save size={14} />
                                      </Button>
                                      <Button size="sm" variant="secondary" onClick={() => setEditingMatch(null)}>
                                        <XCircle size={14} />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className={adminStyles.matchResult}>
                                    {match.completed ? (
                                      <div className={adminStyles.resultInfo}>
                                        <span className={adminStyles.score}>
                                          {match.home_goals} - {match.away_goals}
                                        </span>
                                        {match.went_120 && <span className={adminStyles.badge}>120min</span>}
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
                                        variant="outline"
                                        onClick={() => {
                                          setEditingMatch(match.id);
                                          setMatchData({
                                            ...matchData,
                                            [match.id]: { ...match, home_goals: '', away_goals: '' },
                                          });
                                        }}
                                      >
                                        Result
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
                  </section>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
