import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { generateRoundRobin, generateRecurring } from '../../utils/scheduler';
import { TeamDisplay } from '../../components/TeamDisplay/TeamDisplay';
import { Trash2, Plus, Play, Save, Copy, RefreshCw, XCircle } from 'lucide-react';
import styles from './TournamentAdmin.module.scss';

interface MatchWithTeams {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  home_team: { name: string; ht_team_id: number; active: boolean };
  away_team: { name: string; ht_team_id: number; active: boolean };
}

interface Team {
  id: string;
  tournament_id: string;
  name: string;
  ht_team_id: number;
  active: boolean;
  created_at: string;
}

interface Tournament {
  id: string;
  slug: string;
  name: string;
  admin_password: string;
  scoring_mode: string;
  is_private: boolean;
  description: string | null;
  show_description: boolean;
}

interface RoundWithMatches {
  id: string;
  round_number: number;
  matches: MatchWithTeams[];
}

export const TournamentAdmin: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [rounds, setRounds] = useState<RoundWithMatches[]>([]);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState(location.state?.password || localStorage.getItem(`admin_pw_${slug}`) || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'single' | 'double' | 'recurring'>('single');

  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<Record<string, Partial<MatchWithTeams>>>({});

  const [replacingTeamId, setReplacingTeamId] = useState<string | null>(null);
  const [replacementHtId, setReplacementHtId] = useState('');
  const [replacementName, setReplacementName] = useState('');

  // Tournament settings states
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [showEditDescription, setShowEditDescription] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);

  // Collapsible states
  const [isSettingsCollapsed, setIsSettingsCollapsed] = useState(true);
  const [isTeamsCollapsed, setIsTeamsCollapsed] = useState(() => {
    const saved = localStorage.getItem(`teams_collapsed_${slug}`);
    return saved ? JSON.parse(saved) : false;
  });

  const fetchDetails = useCallback(async (tournamentId: string) => {
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
  }, []);

  const fetchTournament = useCallback(async () => {
    const { data } = await supabase.from('tournaments').select('*').eq('slug', slug).single();

    if (data) {
      setTournament(data);
      setEditIsPrivate(data.is_private);
      setShowEditDescription(data.show_description);
      setEditDescription(data.description || '');
      if (password === data.admin_password) {
        setIsAuthenticated(true);
        fetchDetails(data.id);
      }
    }
    setLoading(false);
  }, [slug, password, fetchDetails]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTournament();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchTournament]);

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

  const updateSettings = async () => {
    if (!tournament) return;
    setIsUpdatingSettings(true);
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({
          is_private: editIsPrivate,
          show_description: showEditDescription,
          description: editDescription,
        })
        .eq('id', tournament.id);

      if (error) throw error;
      fetchTournament();
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsUpdatingSettings(false);
    }
  };

  const addTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournament) return;
    if (!newTeamName.trim() || !newTeamId.trim()) {
      alert('Both Team Name and HT ID are required.');
      return;
    }

    if (!/^\d{1,10}$/.test(newTeamId.trim())) {
      alert('HT ID must be a valid number.');
      return;
    }

    const htIdInt = parseInt(newTeamId.trim());
    if (teams.some((t) => t.ht_team_id === htIdInt)) {
      alert('This team is already in the tournament.');
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
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsSavingTeam(false);
    }
  };

  const replaceTeam = async (oldTeamId: string) => {
    if (!tournament) return;
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
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsSavingTeam(false);
    }
  };

  const deactivateTeam = async (id: string) => {
    if (!tournament) return;
    if (window.confirm('Are you sure you want to deactivate this team?')) {
      await supabase.from('teams').update({ active: false }).eq('id', id);
      fetchDetails(tournament.id);
    }
  };

  const deleteTeam = async (id: string) => {
    if (!tournament) return;
    if (rounds.length > 0) {
      deactivateTeam(id);
      return;
    }
    await supabase.from('teams').delete().eq('id', id);
    fetchDetails(tournament.id);
  };

  const regenerateSchedule = async () => {
    if (!tournament) return;
    if (!window.confirm('Are you sure you want to regenerate the schedule? All current results will be lost!')) {
      return;
    }
    setIsGenerating(true);
    try {
      const { error } = await supabase.from('rounds').delete().eq('tournament_id', tournament.id);

      if (error) throw error;
      await fetchDetails(tournament.id);
    } catch (err: unknown) {
      alert('Error regenerating: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsGenerating(false);
    }
  };

  const generateSchedule = async () => {
    if (!tournament) return;
    const activeTeams = teams.filter((t) => t.active);
    if (activeTeams.length < 2) {
      alert('Need at least 2 active teams');
      return;
    }
    setIsGenerating(true);

    let schedule;
    if (scheduleMode === 'recurring') {
      schedule = generateRecurring(
        activeTeams.map((t) => t.id),
        1,
        4,
      );
    } else {
      schedule = generateRoundRobin(
        activeTeams.map((t) => t.id),
        {
          mode: scheduleMode as 'single' | 'double',
          neutralInSingle: true,
        },
      );
    }

    try {
      for (const roundInfo of schedule) {
        const { data: round, error: rError } = await supabase
          .from('rounds')
          .insert([{ tournament_id: tournament.id, round_number: roundInfo.roundNumber }])
          .select()
          .single();

        if (rError) throw rError;

        if (round) {
          const matchesToInsert = roundInfo.matches.map((m) => ({
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
    } catch (err: unknown) {
      alert('Error generating schedule: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsGenerating(false);
    }
  };

  const generateMoreRounds = async () => {
    if (!tournament) return;
    const lastRoundNumber = rounds.length > 0 ? rounds[rounds.length - 1].round_number : 0;
    const activeTeams = teams.filter((t) => t.active);
    setIsGenerating(true);

    const schedule = generateRecurring(
      activeTeams.map((t) => t.id),
      lastRoundNumber + 1,
      4,
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
          const matchesToInsert = roundInfo.matches.map((m) => ({
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
    } catch (err: unknown) {
      alert('Error generating more rounds: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsGenerating(false);
    }
  };

  const updateMatch = async (matchId: string) => {
    if (!tournament) return;
    const data = matchData[matchId];
    if (!data) return;
    const { error } = await supabase
      .from('matches')
      .update({
        home_goals:
          data.home_goals !== undefined && data.home_goals !== null ? parseInt(String(data.home_goals)) : null,
        away_goals:
          data.away_goals !== undefined && data.away_goals !== null ? parseInt(String(data.away_goals)) : null,
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

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!tournament) return <div className={styles.loading}>Tournament not found</div>;

  if (!isAuthenticated) {
    return (
      <div className={styles.auth}>
        <Card title="Admin Login" variant="classic">
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
            <Button type="submit" fullWidth variant="primary">
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
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <h1>{tournament.name} (Admin)</h1>
          <div className={styles.headerActions}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                alert('URL copied to clipboard!');
              }}
            >
              <Copy size={16} /> Copy Public URL
            </Button>
          </div>
        </div>
        <div className={styles.meta}>
          <div className={styles.metaItem}>
            <span className={styles.label}>Public URL:</span>
            <a href={publicUrl} target="_blank">
              <code>{publicUrl}</code>
            </a>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.label}>
              Admin Password{' '}
              <em
                onClick={() => {
                  navigator.clipboard.writeText(tournament.admin_password);
                  alert('Password copied to clipboard!');
                }}
                style={{ cursor: 'pointer', textDecoration: 'underline' }}
              >
                (save it!)
              </em>
            </span>
            <code>{tournament.admin_password}</code>
          </div>
        </div>
      </header>

      <div className={styles.mainGrid}>
        <section className={styles.teamsSection}>
          <Card
            title="Tournament Settings"
            variant="classic"
            collapsible
            isCollapsed={isSettingsCollapsed}
            onToggleCollapse={() => setIsSettingsCollapsed(!isSettingsCollapsed)}
          >
            <div className={styles.settingsGroup} style={{ marginBottom: '1.5rem' }}>
              <div className={styles.checkboxField} style={{ marginBottom: '1rem' }}>
                <label className={styles.checkboxLabel}>
                  <input type="checkbox" checked={editIsPrivate} onChange={(e) => setEditIsPrivate(e.target.checked)} />
                  Private Tournament (unlisted on home page)
                </label>
              </div>

              <div className={styles.checkboxField}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={showEditDescription}
                    onChange={(e) => setShowEditDescription(e.target.checked)}
                  />
                  Show Description
                </label>
              </div>

              {showEditDescription && (
                <div className={styles.textField} style={{ marginTop: '1rem' }}>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Tournament description..."
                    rows={4}
                  />
                </div>
              )}
            </div>
            <Button onClick={updateSettings} disabled={isUpdatingSettings} variant="primary" size="sm">
              {isUpdatingSettings ? 'Saving...' : 'Save Settings'}
            </Button>
          </Card>

          <Card
            title="Manage Teams & Schedule"
            variant="classic"
            collapsible
            isCollapsed={isTeamsCollapsed}
            onToggleCollapse={() => {
              const newState = !isTeamsCollapsed;
              setIsTeamsCollapsed(newState);
              localStorage.setItem(`teams_collapsed_${slug}`, JSON.stringify(newState));
            }}
          >
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
                            <div className={styles.replaceActions}>
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
                        <button onClick={() => deleteTeam(team.id)} className={styles.deleteBtn}>
                          {isGenerated ? <XCircle size={20} /> : <Trash2 size={20} />}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className={styles.scheduleControl}>
              {!isGenerated ? (
                <div className={styles.genOptions}>
                  <div className={styles.checkboxGroup}>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="radio"
                        name="scheduleMode"
                        checked={scheduleMode === 'double'}
                        onChange={() => setScheduleMode('double')}
                      />
                      Play each other twice (Home and Away)
                    </label>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="radio"
                        name="scheduleMode"
                        checked={scheduleMode === 'single'}
                        onChange={() => setScheduleMode('single')}
                      />
                      Play each other once (Neutral ground)
                    </label>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="radio"
                        name="scheduleMode"
                        checked={scheduleMode === 'recurring'}
                        onChange={() => setScheduleMode('recurring')}
                      />
                      Recurring schedule (Continuous)
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
                <div className={styles.genActions}>
                  <Button variant="outline" onClick={regenerateSchedule} disabled={isGenerating} fullWidth>
                    <RefreshCw size={18} /> Regenerate Schedule
                  </Button>
                  {scheduleMode === 'recurring' && (
                    <Button
                      variant="outline"
                      onClick={generateMoreRounds}
                      disabled={isGenerating}
                      fullWidth
                      style={{ marginTop: '0.5rem' }}
                    >
                      {isGenerating ? 'Generating...' : 'Generate more rounds'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        </section>

        {isGenerated && (
          <section className={styles.fixturesSection}>
            <div className={styles.fixturesHeader}>
              <h2>Fixtures & Results</h2>
            </div>
            {rounds.map((round) => (
              <Card key={round.id} title={`⚽️ Round ${round.round_number}`} variant="classic">
                <div className={styles.matches}>
                  {round.matches.map((match: MatchWithTeams) => {
                    return (
                      <div key={match.id} className={styles.match}>
                        <div className={styles.matchTeams}>
                          <TeamDisplay team={match.home_team} side="home" />
                          <span className={styles.vs}>vs</span>
                          <TeamDisplay team={match.away_team} side="away" />
                        </div>

                        {editingMatch === match.id ? (
                          <div className={styles.matchEdit}>
                            <div className={styles.scoreInputs}>
                              <input
                                name={`score_home_${match.id}`}
                                type="number"
                                placeholder="H"
                                value={matchData[match.id]?.home_goals ?? match.home_goals ?? ''}
                                onChange={(e) => {
                                  const updatedMatch = {
                                    ...(matchData[match.id] || match),
                                    home_goals: e.target.value === '' ? null : Number(e.target.value),
                                  };
                                  setMatchData({
                                    ...matchData,
                                    [match.id]: updatedMatch,
                                  });
                                }}
                              />
                              <span className={styles.divider}>-</span>
                              <input
                                name={`score_away_${match.id}`}
                                type="number"
                                placeholder="A"
                                value={matchData[match.id]?.away_goals ?? match.away_goals ?? ''}
                                onChange={(e) => {
                                  const updatedMatch = {
                                    ...(matchData[match.id] || match),
                                    away_goals: e.target.value === '' ? null : Number(e.target.value),
                                  };
                                  setMatchData({
                                    ...matchData,
                                    [match.id]: updatedMatch,
                                  });
                                }}
                              />
                            </div>
                            <label className={styles.went120}>
                              <input
                                type="checkbox"
                                checked={matchData[match.id]?.went_120 ?? match.went_120 ?? false}
                                onChange={(e) => {
                                  const updatedMatch = {
                                    ...(matchData[match.id] || match),
                                    went_120: e.target.checked,
                                  };
                                  setMatchData({
                                    ...matchData,
                                    [match.id]: updatedMatch,
                                  });
                                }}
                              />
                              120m
                            </label>
                            <div className={styles.editActions}>
                              <Button size="sm" onClick={() => updateMatch(match.id)} variant="primary">
                                <Save size={14} />
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => setEditingMatch(null)}>
                                <XCircle size={14} />
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
                                  variant="outline"
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
                                  const resetMatch: Partial<MatchWithTeams> = {
                                    ...match,
                                    home_goals: null,
                                    away_goals: null,
                                  };
                                  setMatchData({
                                    ...matchData,
                                    [match.id]: resetMatch,
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
          </section>
        )}
      </div>
    </div>
  );
};
