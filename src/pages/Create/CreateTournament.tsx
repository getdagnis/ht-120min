import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { nanoid } from 'nanoid';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { Trash2, Plus, ArrowRight, Save } from 'lucide-react';
import styles from './CreateTournament.module.scss';

interface LocalTeam {
  tempId: string;
  name: string;
  htId: string;
}

export const CreateTournament: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [step, setStep] = useState<'info' | 'teams'>('info');
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    scoring_mode: '120m',
  });

  const [teams, setTeams] = useState<LocalTeam[]>([]);
  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    if (formData.slug) {
      setCheckingSlug(true);
      const { data, error } = await supabase.from('tournaments').select('slug').eq('slug', formData.slug).maybeSingle();

      setCheckingSlug(false);

      if (data) {
        alert('This URL slug is already taken. Please choose another one.');
        return;
      }

      if (error) {
        console.error('Error checking slug:', error);
      }
    }

    setStep('teams');
  };

  const addLocalTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newTeamId.trim()) return;

    setTeams([
      ...teams,
      {
        tempId: nanoid(),
        name: newTeamName.trim(),
        htId: newTeamId.trim(),
      },
    ]);

    setNewTeamId('');
    setNewTeamName('');
  };

  const removeLocalTeam = (tempId: string) => {
    setTeams(teams.filter((t) => t.tempId !== tempId));
  };

  const handleFinalSubmit = async () => {
    if (teams.length < 2) {
      alert('At least 2 teams are required to create a tournament.');
      return;
    }

    setLoading(true);
    const slug = formData.slug || nanoid(10);
    const adminPassword = nanoid(8);

    // 1. Create tournament
    const { data: tournament, error: tError } = await supabase
      .from('tournaments')
      .insert([
        {
          name: formData.name,
          slug,
          scoring_mode: formData.scoring_mode,
          admin_password: adminPassword,
        },
      ])
      .select()
      .single();

    if (tError) {
      alert('Error creating tournament: ' + tError.message);
      setLoading(false);
      return;
    }

    // 2. Create teams
    const teamsToInsert = teams.map((t) => ({
      tournament_id: tournament.id,
      name: t.name,
      ht_team_id: parseInt(t.htId),
      active: true,
    }));

    const { error: teamsError } = await supabase.from('teams').insert(teamsToInsert);

    if (teamsError) {
      alert('Tournament created but error adding teams: ' + teamsError.message);
      // Still navigate because tournament exists
    }

    localStorage.setItem(`admin_pw_${slug}`, adminPassword);
    navigate(`/t/${slug}/admin`, { state: { password: adminPassword, isNew: true } });
  };

  if (step === 'info') {
    return (
      <div className={styles.container}>
        <Card variant="hero">
          <h1>Create Tournament</h1>
          <img src="/create.png" alt="HT-120min" />
          <form onSubmit={handleContinue} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="tournament_name">Tournament Name</label>
              <input
                id="tournament_name"
                name="tournament_name"
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Guam HFI Season 1"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="tournament_slug">Custom URL Slug (optional)</label>
              <input
                id="tournament_slug"
                name="tournament_slug"
                type="text"
                value={formData.slug}
                onChange={(e) =>
                  setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })
                }
                placeholder="e.g. guam-hfi-s1"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="scoring_mode">Scoring Mode</label>
              <select
                id="scoring_mode"
                name="scoring_mode"
                value={formData.scoring_mode}
                onChange={(e) => setFormData({ ...formData, scoring_mode: e.target.value })}
              >
                <option value="120m">120 Minute Training Achievements</option>
                <option value="points">Standard Victory Points (3/1/0)</option>
              </select>
            </div>

            <div className={styles.actions}>
              <Button type="submit" fullWidth disabled={checkingSlug} variant="secondary">
                {checkingSlug ? 'Checking URL...' : 'Continue'} <ArrowRight size={18} />
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Card variant="hero">
        <h1>Add Teams</h1>
        <p className={styles.subtitle}>{formData.name}</p>
        <img src="/bus1.png" alt="Add Teams" />
        <p className={styles.subtitle}>Add at least two teams. You can add more later.</p>
        <form onSubmit={addLocalTeam} className={styles.teamForm}>
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
          <Button type="submit" variant="secondary">
            <Plus size={18} /> Add
          </Button>
        </form>

        <ul className={styles.teamList}>
          {teams.map((team) => (
            <li key={team.tempId}>
              <div className={styles.teamInfo}>
                <span className={styles.name}>{team.name}</span>
                <span className={styles.id}>ID: {team.htId}</span>
              </div>
              <button onClick={() => removeLocalTeam(team.tempId)} className={styles.deleteBtn}>
                <Trash2 size={18} />
              </button>
            </li>
          ))}
          {teams.length === 0 && <p className={styles.empty}>No teams added yet.</p>}
        </ul>

        <div className={styles.genActions}>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={handleFinalSubmit}
            disabled={teams.length < 2 || loading}
          >
            <Save size={18} /> {loading ? 'Creating...' : 'Create Tournament'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setStep('info')}
            disabled={loading}
            style={{ opacity: 0.8 }}
          >
            Go Back
          </Button>
        </div>
      </Card>
    </div>
  );
};
