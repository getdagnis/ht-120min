import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { nanoid } from 'nanoid';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { Lineicons } from '@lineiconshq/react-lineicons';
import {
  Trash3Outlined,
  PlusOutlined,
  ArrowRightOutlined,
  FloppyDisk1Outlined,
  RefreshCircle1ClockwiseOutlined,
  Link2AngularRightOutlined,
  HandShakeOutlined,
} from '@lineiconshq/free-icons';
import { DESCRIPTIONS, TOURNAMENT_NAMES } from '../../constants/descriptions';
import styles from './CreateTournament.module.sass';

interface LocalTeam {
  tempId: string;
  name: string;
  htId: string;
}

const getRandomDescription = () => DESCRIPTIONS[Math.floor(Math.random() * DESCRIPTIONS.length)];
const getRandomName = () => TOURNAMENT_NAMES[Math.floor(Math.random() * TOURNAMENT_NAMES.length)];

export const CreateTournament: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [isFetchingTeamData, setIsFetchingTeamData] = useState(false);
  const [step, setStep] = useState<'info' | 'teams'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('step') === 'teams' ? 'teams' : 'info';
  });

  const [organizerName, setOrganizerName] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('linked') === 'true' ? 'Linked Organizer' : ''; // We could pass name in redirect
  });

  // Initialize state from localStorage to avoid synchronous setState in useEffect
  const [formData, setFormData] = useState(() => {
    const saved = localStorage.getItem('create_tournament_progress');
    if (saved) {
      const { formData: savedForm } = JSON.parse(saved);
      if (savedForm) return savedForm;
    }
    return {
      name: '',
      slug: '',
      scoring_mode: '120min',
      league_category: 'male',
      registration_type: 'validated',
      is_private: false,
      description: getRandomDescription(),
    };
  });

  const [teams, setTeams] = useState<LocalTeam[]>(() => {
    const saved = localStorage.getItem('create_tournament_progress');
    return saved ? JSON.parse(saved).teams || [] : [];
  });

  const [showDescription, setShowDescription] = useState(() => {
    const saved = localStorage.getItem('create_tournament_progress');
    return saved ? (JSON.parse(saved).showDescription ?? false) : false;
  });

  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');

  const fetchTeamData = async (htId: string) => {
    if (!htId || htId.length < 6) return;
    setIsFetchingTeamData(true);
    try {
      const res = await fetch(`/api/teams/info?team_id=${htId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch team data');

      // Validation check
      const category = formData.league_category || 'male';
      const categoryName = category === 'hfi' ? 'Hattrick Femme International (HFI)' : 'Regular league (male)';
      const isFemaleLeague = data.teamName?.includes('Femme') || data.leagueId === 3000;
      const isMaleLeague = !isFemaleLeague;
      const teamCategory = isFemaleLeague ? 'HFI' : 'male league';

      if (category === 'hfi' && !isFemaleLeague) {
        throw new Error(`Team ID ${htId} "${data.teamName}" (${teamCategory}) is not eligible to play in a ${categoryName}. Please register a ${categoryName} team or change the tournament category.`);
      }
      if (category === 'male' && !isMaleLeague) {
        throw new Error(`Team ID ${htId} "${data.teamName}" (${teamCategory}) is not eligible to play in a ${categoryName}. Please register a ${categoryName} team or change the tournament category.`);
      }

      setNewTeamName(data.teamName);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsFetchingTeamData(false);
    }
  };

  const saveProgress = (updatedForm = formData, updatedTeams = teams, updatedShowDesc = showDescription) => {
    localStorage.setItem(
      'create_tournament_progress',
      JSON.stringify({
        formData: updatedForm,
        teams: updatedTeams,
        showDescription: updatedShowDesc,
      }),
    );
  };

  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '') // Remove invalid chars
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/-+/g, '-'); // Remove duplicate dashes

    setFormData({ ...formData, name, slug });
  };

  const regenerateDescription = () => {
    const newDesc = getRandomDescription();
    const updatedForm = { ...formData, description: newDesc };
    setFormData(updatedForm);
    saveProgress(updatedForm);
  };

  const regenerateName = () => {
    const newName = getRandomName();
    handleNameChange(newName);
  };

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setCheckingSlug(true);
    let finalSlug = formData.slug || nanoid(10);

    // Check for collision
    const { data } = await supabase.from('tournaments').select('slug').eq('slug', finalSlug).maybeSingle();

    if (data) {
      // Collision found, append random 3 chars
      const suffix = nanoid(3).toLowerCase();
      finalSlug = `${finalSlug}-${suffix}`;
    }

    const updatedForm = { ...formData, slug: finalSlug };
    setFormData(updatedForm);
    saveProgress(updatedForm);
    setCheckingSlug(false);
    setStep('teams');
  };

  const addLocalTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newTeamId.trim()) return;

    if (teams.some((t) => t.htId === newTeamId.trim())) {
      alert('This Team ID is already in the list.');
      return;
    }

    const updatedTeams = [
      ...teams,
      {
        tempId: nanoid(),
        name: newTeamName.trim(),
        htId: newTeamId.trim(),
      },
    ];

    setTeams(updatedTeams);
    saveProgress(formData, updatedTeams);

    setNewTeamId('');
    setNewTeamName('');
  };

  const removeLocalTeam = (tempId: string) => {
    const updatedTeams = teams.filter((t) => t.tempId !== tempId);
    setTeams(updatedTeams);
    saveProgress(formData, updatedTeams);
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
          league_category: formData.league_category,
          registration_type: formData.registration_type,
          admin_password: adminPassword,
          is_private: formData.is_private,
          description: showDescription ? formData.description : null,
          thumbnail_index: Math.floor(Math.random() * 17) + 1,
          season: 1,
          status: 'open',
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
    }

    localStorage.removeItem('create_tournament_progress');
    localStorage.setItem(`admin_pw_${slug}`, adminPassword);
    navigate(`/t/${slug}`, { state: { isAdminInit: false } });
  };

  if (step === 'info') {
    return (
      <div className={styles.container}>
        <Card variant="hero">
          <h1>Create Tournament</h1>
          <img src="/create.png" alt="HT-120min" />
          <form onSubmit={handleContinue} className={styles.form}>
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label htmlFor="tournament_name">Tournament Name</label>
                <button type="button" onClick={regenerateName} className={styles.iconBtn} title="Regenerate Name">
                  <Lineicons icon={RefreshCircle1ClockwiseOutlined} size={20} />
                </button>
              </div>
              <input
                id="tournament_name"
                name="tournament_name"
                type="text"
                required
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Awesome Great Tournament S1 ⭐️"
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="tournament_slug">Unique URL Slug</label>
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
              <label htmlFor="league_category">Tournament Category</label>
              <select
                id="league_category"
                value={formData.league_category}
                onChange={(e) => setFormData({ ...formData, league_category: e.target.value })}
              >
                <option value="male">Regular league (male)</option>
                <option value="hfi">Hattrick Femme International (HFI)</option>
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="registration_type">Registration Type</label>
              <select
                id="registration_type"
                value={formData.registration_type}
                onChange={(e) => setFormData({ ...formData, registration_type: e.target.value })}
              >
                <option value="validated">Hattrick Validated (CHPP)</option>
                <option value="manual">Organizer-Managed</option>
              </select>
              <p style={{ fontSize: '0.8rem', marginTop: '0.4rem', opacity: 0.8 }}>
                {formData.registration_type === 'validated' 
                  ? 'Only managers themselves can join with their teams.' 
                  : 'Organizer can add teams, but anyone can still self-register.'}
              </p>
            </div>

            <div className={styles.field}>
              <label htmlFor="scoring_mode">Scoring Mode</label>
              <select
                id="scoring_mode"
                name="scoring_mode"
                value={formData.scoring_mode}
                onChange={(e) => setFormData({ ...formData, scoring_mode: e.target.value })}
              >
                <option value="120min">🪫 Rank by 120 minute achievements</option>
                <option value="points">🥇 Regular 90 min friendlies (3p/1p/0)</option>
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={formData.is_private}
                  onChange={(e) => setFormData({ ...formData, is_private: e.target.checked })}
                />
                Private Tournament (unlisted on home page)
              </label>
            </div>

            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={showDescription}
                    onChange={(e) => {
                      const updated = e.target.checked;
                      setShowDescription(updated);
                      saveProgress(formData, teams, updated);
                    }}
                  />
                  Add Description (optional)
                </label>
                {showDescription && (
                  <button
                    type="button"
                    onClick={regenerateDescription}
                    className={styles.iconBtn}
                    title="Regenerate Description"
                  >
                    <Lineicons icon={RefreshCircle1ClockwiseOutlined} size={20} />
                  </button>
                )}
              </div>
              {showDescription && (
                <textarea
                  value={formData.description}
                  onChange={(e) => {
                    const updatedForm = { ...formData, description: e.target.value };
                    setFormData(updatedForm);
                    saveProgress(updatedForm);
                  }}
                  placeholder="Tell participants about the tournament, rules, or prizes..."
                  rows={4}
                  className={styles.textarea}
                />
              )}
            </div>

            <div className={styles.actions}>
              <Button type="submit" fullWidth disabled={checkingSlug} variant="secondary">
                {checkingSlug ? 'Checking URL...' : 'Continue'} <Lineicons icon={ArrowRightOutlined} size={18} />
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  const handleHattrickLink = async () => {
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
          league_category: formData.league_category,
          registration_type: formData.registration_type,
          admin_password: adminPassword,
          is_private: formData.is_private,
          description: showDescription ? formData.description : null,
          thumbnail_index: Math.floor(Math.random() * 17) + 1,
          season: 1,
          status: 'open',
        },
      ])
      .select()
      .single();

    if (tError) {
      alert('Error creating tournament: ' + tError.message);
      setLoading(false);
      return;
    }

    // 2. Create teams (manual ones added so far)
    if (teams.length > 0) {
      const teamsToInsert = teams.map((t) => ({
        tournament_id: tournament.id,
        name: t.name,
        ht_team_id: parseInt(t.htId),
        active: true,
      }));
      await supabase.from('teams').insert(teamsToInsert);
    }

    localStorage.removeItem('create_tournament_progress');
    localStorage.setItem(`admin_pw_${slug}`, adminPassword);

    // 3. Redirect to OAuth
    window.location.href = `/api/auth/init?tournament_id=${tournament.id}&is_creation=true`;
  };

  return (
    <div className={styles.container}>
      <Card variant="hero">
        <h1>Add Teams</h1>
        <p className={styles.subtitle}>{formData.name}</p>
        <img src="/register2.png" alt="Add Teams" />
        
        {organizerName ? (
          <div style={{ marginBottom: '2rem', textAlign: 'center', background: 'var(--bg-transp2)', padding: '1rem', borderRadius: '0.75rem' }}>
            <p style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '0.25rem' }}>Organizer:</p>
            <p style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--accent)' }}>{organizerName}</p>
          </div>
        ) : (
          <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
            <Button
              size="lg"
              variant="primary"
              onClick={handleHattrickLink}
              disabled={loading}
            >
              <Lineicons icon={HandShakeOutlined} size={20} /> Link Organizer Profile
            </Button>
            <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', opacity: 0.8 }}>
              Required to manage and finalize the tournament.
            </p>
          </div>
        )}

        <p className={styles.subtitle}>
          {formData.registration_type === 'validated' 
            ? 'In a self-validated tournament, you must invite teams to join.' 
            : 'Add teams participating in this season.'}
        </p>

        <form onSubmit={addLocalTeam} className={styles.teamForm}>
          <div className={styles.inputGroup}>
            <input
              name="team_ht_id"
              type="text"
              placeholder="HT Team ID"
              value={newTeamId}
              onChange={(e) => {
                setNewTeamId(e.target.value.replace(/\D/g, ''));
                setNewTeamName('');
              }}
              minLength={6}
              maxLength={9}
              required
            />
            <input
              name="team_name"
              type="text"
              placeholder="Team Name"
              value={newTeamName}
              readOnly
              style={{ pointerEvents: 'none', opacity: newTeamName ? 1 : 0.6 }}
              required
            />
          </div>
          {newTeamId.length >= 6 && !newTeamName && (
             <Button 
              type="button" 
              onClick={() => fetchTeamData(newTeamId)} 
              disabled={isFetchingTeamData}
              variant="primary"
              size="md"
             >
              <Lineicons icon={HandShakeOutlined} size={18} /> {isFetchingTeamData ? '...' : 'Get data'}
            </Button>
          )}
          {newTeamName && (
            <Button type="submit" variant="secondary" size="md">
              <Lineicons icon={PlusOutlined} size={20} /> {formData.registration_type === 'validated' ? 'Invite' : 'Add'}
            </Button>
          )}
        </form>

        <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--bg-transp2)', borderRadius: '0.75rem', border: '1px dashed var(--border)' }}>
          <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', textTransform: 'uppercase' }}>Hattrick Invite Template</p>
          <textarea
            readOnly
            style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '0.5rem', color: 'var(--text)', padding: '0.5rem', fontSize: '0.85rem', minHeight: '60px', resize: 'none' }}
            value={`Join our new tournament "${formData.name}" on HT-120min! Register here: ${window.location.origin}/t/${formData.slug}`}
          />
        </div>

        <ul className={styles.teamList}>
          {teams.map((team) => (
            <li key={team.tempId}>
              <div className={styles.teamInfo}>
                <span className={styles.name}>
                  {team.name}{' '}
                  <a
                    href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.htId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.htLink}
                  >
                    <Lineicons icon={Link2AngularRightOutlined} size={16} />
                  </a>
                </span>

                <span className={styles.id}>ID: {team.htId}</span>
              </div>
              <button onClick={() => removeLocalTeam(team.tempId)} className={styles.deleteBtn}>
                <Lineicons icon={Trash3Outlined} size={18} />
              </button>
            </li>
          ))}
          {teams.length === 0 && <p className={styles.empty}>No teams added yet.</p>}
        </ul>

        <div className={styles.genActions}>
          {organizerName && (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={handleFinalSubmit}
              disabled={loading}
              style={{ marginBottom: '1rem' }}
            >
              <Lineicons icon={FloppyDisk1Outlined} size={18} /> Finalize and Create Season 1
            </Button>
          )}
          <Button
            variant="outlineWhite"
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
