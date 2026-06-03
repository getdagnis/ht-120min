import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { nanoid } from 'nanoid';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { Modal } from '../../components/Modal/Modal';
import { Lineicons } from '@lineiconshq/react-lineicons';
import {
  Trash3Outlined,
  PlusOutlined,
  ArrowRightOutlined,
  RefreshCircle1ClockwiseOutlined,
  Link2AngularRightOutlined,
  HandShakeOutlined,
  Trophy1Outlined,
  ChevronLeftOutlined,
} from '@lineiconshq/free-icons';
import { DESCRIPTIONS, TOURNAMENT_NAMES } from '../../constants/descriptions';
import { filterTeamsForCategory, teamMatchesCategory, type LeagueCategory } from '../../utils/team-eligibility';
import styles from './CreateTournament.module.sass';

interface LocalTeam {
  tempId: string;
  name: string;
  htId: string;
  isCreator?: boolean;
  accessToken?: string;
  accessTokenSecret?: string;
  managerName?: string;
  hattrickUserId?: number;
  logoUrl?: string;
  countryName?: string;
}

const getRandomDescription = () => DESCRIPTIONS[Math.floor(Math.random() * DESCRIPTIONS.length)];
const getRandomName = () => TOURNAMENT_NAMES[Math.floor(Math.random() * TOURNAMENT_NAMES.length)];

export const CreateTournament: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [step, setStep] = useState<'info' | 'teams'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('step') === 'teams' ? 'teams' : 'info';
  });

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

  const [isLinked, setIsLinked] = useState(false);
  const [linkedManager, setLinkedManager] = useState<{
    selection_token: string;
    manager_name: string;
    access_token: string;
    access_token_secret: string;
    hattrick_user_id: number | null;
    teams_json: Array<{
      teamId: number;
      teamName: string;
      leagueLevelUnitName?: string;
      regionName?: string;
      leagueName?: string;
    }>;
  } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);

  const saveProgress = useCallback((updatedForm = formData, updatedTeams = teams, updatedShowDesc = showDescription) => {
    localStorage.setItem(
      'create_tournament_progress',
      JSON.stringify({
        formData: updatedForm,
        teams: updatedTeams,
        showDescription: updatedShowDesc,
      }),
    );
  }, [formData, teams, showDescription]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('step') === 'teams') setStep('teams');

    const token = params.get('token');
    if (token) void fetchPendingSession(token);

    const error = params.get('error');
    if (error) alert(decodeURIComponent(error));
  }, []);

  const fetchPendingSession = async (token: string) => {
    setShowModal(true);
    setModalLoading(true);

    const { data, error } = await supabase
      .from('oauth_pending_joins')
      .select('*')
      .eq('selection_token', token)
      .single();

    setModalLoading(false);

    if (error || !data) {
      setShowModal(false);
      alert('Invalid or expired linking session.');
      return;
    }

    setLinkedManager(data);
    setStep('teams');
  };

  const clearPendingJoin = async (selectionToken: string) => {
    await supabase.from('oauth_pending_joins').delete().eq('selection_token', selectionToken);
  };

  const goBackToSettings = async () => {
    const token =
      linkedManager?.selection_token ?? new URLSearchParams(window.location.search).get('token') ?? undefined;
    if (token) await clearPendingJoin(token);

    setShowModal(false);
    setLinkedManager(null);
    setIsLinked(false);
    const withoutCreator = teams.filter((t) => !t.isCreator);
    setTeams(withoutCreator);
    setStep('info');
    saveProgress(formData, withoutCreator);
    window.history.replaceState({}, '', '/create');
  };

  const fetchTeamLogoFromChpp = async (
    teamId: number,
    accessToken: string,
    accessTokenSecret: string,
  ): Promise<{ logoUrl?: string; countryName?: string }> => {
    try {
      const res = await fetch('/api/chpp/teamdetails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, access_token: accessToken, access_token_secret: accessTokenSecret }),
      });
      if (!res.ok) return {};
      const data = await res.json();
      return { logoUrl: data.logoUrl ?? undefined, countryName: data.countryName ?? undefined };
    } catch {
      return {};
    }
  };

  const handleCreatorTeamSelect = async (team: {
    teamId: number;
    teamName: string;
    leagueLevelUnitName?: string;
    regionName?: string;
  }) => {
    if (!linkedManager) return;

    const { logoUrl, countryName } = await fetchTeamLogoFromChpp(
      team.teamId,
      linkedManager.access_token,
      linkedManager.access_token_secret,
    );

    const creatorTeam: LocalTeam = {
      tempId: nanoid(),
      name: team.teamName,
      htId: String(team.teamId),
      isCreator: true,
      accessToken: linkedManager.access_token,
      accessTokenSecret: linkedManager.access_token_secret,
      managerName: linkedManager.manager_name,
      hattrickUserId: linkedManager.hattrick_user_id ?? undefined,
      logoUrl,
      countryName,
    };

    const updatedTeams =
      formData.registration_type === 'validated'
        ? [creatorTeam]
        : [...teams.filter((t) => !t.isCreator), creatorTeam];

    setTeams(updatedTeams);
    setIsLinked(true);
    saveProgress(formData, updatedTeams);
    setShowModal(false);
    setLinkedManager(null);

    await clearPendingJoin(linkedManager.selection_token);
    window.history.replaceState({}, '', '/create?step=teams');
  };

  const handleOrganizerNoJoin = async () => {
    if (linkedManager?.selection_token) {
      await clearPendingJoin(linkedManager.selection_token);
    }
    setIsLinked(true);
    setShowModal(false);
    setLinkedManager(null);
    window.history.replaceState({}, '', '/create?step=teams');
  };

  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [isFetchingTeamData, setIsFetchingTeamData] = useState(false);

  const fetchTeamData = async (htId: string) => {
    if (!htId || htId.length < 6) return;
    setIsFetchingTeamData(true);
    try {
      const res = await fetch(`/api/teams/info?team_id=${htId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch team data');

      const category = (formData.league_category === 'hfi' ? 'hfi' : 'male') as LeagueCategory;
      if (!teamMatchesCategory({ leagueName: data.teamName, leagueId: data.leagueId }, category)) {
        throw new Error(
          `Team ID ${htId} "${data.teamName}" is not eligible for ${category === 'hfi' ? 'HFI' : 'Regular male'} based tournament. Please register a matching team or change the tournament category.`,
        );
      }

      setNewTeamName(data.teamName);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsFetchingTeamData(false);
    }
  };

  const handleNameChange = (name: string) => {
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
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
    setStep('teams');
    saveProgress();
  };

  const addLocalTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newTeamId.trim()) return;
    if (teams.some((t) => t.htId === newTeamId.trim())) {
      alert('This Team ID is already in the list.');
      return;
    }
    const updatedTeams = [...teams, { tempId: nanoid(), name: newTeamName.trim(), htId: newTeamId.trim() }];
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

  const handleHattrickLink = () => {
    saveProgress();
    const params = new URLSearchParams({
      is_creation: 'true',
      league_category: formData.league_category === 'hfi' ? 'hfi' : 'male',
    });
    window.location.href = `/api/auth/init?${params.toString()}`;
  };

  const handleFinalSubmit = async () => {
    const creator = teams.find((t) => t.isCreator);
    const isValidated = formData.registration_type === 'validated';

    if (isValidated) {
      if (!creator) {
        alert('Link your Hattrick team to continue.');
        return;
      }
    } else {
      if (!isLinked) {
        alert('Link your organizer profile via Hattrick first.');
        return;
      }
      if (teams.length < 2) {
        alert('Add at least two teams (or join with your team plus one more).');
        return;
      }
    }

    setLoading(true);
    const slug = formData.slug || nanoid(10);
    const adminPassword = nanoid(8);

    try {
      const { data: tournament, error: tError } = await supabase
        .from('tournaments')
        .insert([{
          name: formData.name, slug, scoring_mode: formData.scoring_mode,
          league_category: formData.league_category, registration_type: formData.registration_type,
          admin_password: adminPassword, is_private: formData.is_private,
          description: showDescription ? formData.description : null,
          thumbnail_index: Math.floor(Math.random() * 17) + 1,
          season: 1, status: 'open',
          organizer_name: isValidated ? null : creator?.managerName || null,
        }])
        .select().single();

      if (tError) throw tError;

      const teamsToInsert = teams.map((t) => ({
        tournament_id: tournament.id, name: t.name, ht_team_id: parseInt(t.htId, 10),
        active: true, joined_via_oauth: !!t.isCreator,
        oauth_token: t.accessToken || null, oauth_token_secret: t.accessTokenSecret || null,
        manager_name: t.managerName || null,
        hattrick_user_id: t.hattrickUserId || null,
        logo_url: t.logoUrl || null,
        country_name: t.countryName || null,
      }));

      const { error: teamsError } = await supabase.from('teams').insert(teamsToInsert);
      if (teamsError) throw teamsError;

      localStorage.removeItem('create_tournament_progress');
      localStorage.setItem(`admin_pw_${slug}`, adminPassword);
      navigate(`/t/${slug}`, { state: { isAdminInit: true } });
    } catch (err: any) {
      alert('Error creating tournament: ' + err.message);
      setLoading(false);
    }
  };

  const creator = teams.find((t) => t.isCreator);
  const isValidated = formData.registration_type === 'validated';
  const canCreate = isValidated ? !!creator : isLinked && teams.length >= 2;

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
              <input id="tournament_name" name="tournament_name" type="text" required value={formData.name} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g. Awesome Great Tournament S1 ⭐️" autoFocus />
            </div>
            <div className={styles.field}>
              <label htmlFor="tournament_slug">Unique URL Slug</label>
              <input id="tournament_slug" name="tournament_slug" type="text" value={formData.slug} onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="e.g. guam-hfi-s1" />
            </div>
            <div className={styles.field}>
              <label htmlFor="league_category">Tournament Category</label>
              <select id="league_category" value={formData.league_category} onChange={(e) => setFormData({ ...formData, league_category: e.target.value })}>
                <option value="male">Regular league (male)</option>
                <option value="hfi">Hattrick Femme International (HFI)</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="registration_type">Registration Type</label>
              <select id="registration_type" value={formData.registration_type} onChange={(e) => setFormData({ ...formData, registration_type: e.target.value })}>
                <option value="validated">Hattrick Validated (CHPP)</option>
                <option value="manual">Organizer-Managed</option>
              </select>
              <p className={styles.small}>
                {formData.registration_type === 'validated' 
                  ? 'Only managers themselves can join with their teams.' 
                  : 'Organizer can add teams, but anyone can still self-register.'}
              </p>
            </div>
            <div className={styles.field}>
              <label htmlFor="scoring_mode">Scoring Mode</label>
              <select id="scoring_mode" name="scoring_mode" value={formData.scoring_mode} onChange={(e) => setFormData({ ...formData, scoring_mode: e.target.value })}>
                <option value="120min">🪫 Rank by 120 minute achievements</option>
                <option value="points">🥇 Regular 90 min friendlies (3p/1p/0)</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.checkboxLabel}>
                <input type="checkbox" checked={formData.is_private} onChange={(e) => setFormData({ ...formData, is_private: e.target.checked })} />
                Private Tournament (unlisted on home page)
              </label>
            </div>
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label className={styles.checkboxLabel}>
                  <input type="checkbox" checked={showDescription} onChange={(e) => setShowDescription(e.target.checked)} />
                  Add Description (optional)
                </label>
                {showDescription && (
                  <button type="button" onClick={regenerateDescription} className={styles.iconBtn} title="Regenerate Description">
                    <Lineicons icon={RefreshCircle1ClockwiseOutlined} size={20} />
                  </button>
                )}
              </div>
              {showDescription && (
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Tell participants about the tournament..." rows={4} className={styles.textarea} />
              )}
            </div>
            <div className={styles.actions}>
              <Button type="submit" fullWidth disabled={checkingSlug} variant="secondary">
                Continue <Lineicons icon={ArrowRightOutlined} size={18} />
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  const categoryLabel = formData.league_category === 'hfi' ? 'HFI' : 'Regular male';
  const leagueCategory = (formData.league_category === 'hfi' ? 'hfi' : 'male') as LeagueCategory;
  const eligibleTeams = linkedManager
    ? filterTeamsForCategory(linkedManager.teams_json, leagueCategory)
    : [];

  if (showModal) {
    return (
      <div className={styles.container}>
        <Modal
          isOpen
          onClose={() => void goBackToSettings()}
          title={linkedManager ? `Welcome, ${linkedManager.manager_name}!` : 'Linking Hattrick…'}
        >
          <div className={styles.modalContent}>
            {modalLoading ? (
              <p>Loading your teams…</p>
            ) : (
              <>
                {!isValidated ? (
                  <p>
                    Join with one of your teams, or organize without playing. You can add other teams on the next
                    screen.
                  </p>
                ) : eligibleTeams.length === 1 ? (
                  <p>
                    You have one team eligible for a <strong>{categoryLabel}</strong> tournament. Select it to
                    continue.
                  </p>
                ) : (
                  <p>
                    Choose which team will join this <strong>{categoryLabel}</strong> tournament. Other managers join
                    themselves via the public link later.
                  </p>
                )}

                {eligibleTeams.length === 0 && !modalLoading && (
                  <p className={styles.empty}>
                    None of your teams match this tournament category ({categoryLabel}).
                  </p>
                )}

                <div className={styles.teamOptionsList}>
                  {eligibleTeams.map((team) => (
                    <div
                      key={team.teamId}
                      className={styles.teamOptionCard}
                      onClick={() => void handleCreatorTeamSelect(team)}
                    >
                      <div className={styles.teamOptionInfo}>
                        <strong>{team.teamName}</strong>
                        <span>
                          {[team.leagueName, team.leagueLevelUnitName, team.regionName].filter(Boolean).join(' • ')}
                        </span>
                      </div>
                      <Lineicons icon={ChevronLeftOutlined} size={20} className="r-180" />
                    </div>
                  ))}
                </div>

                {!isValidated && (
                  <Button variant="outline" fullWidth onClick={() => void handleOrganizerNoJoin()}>
                    I will not join with a team
                  </Button>
                )}

                <div className={styles.modalFooter}>
                  <Button variant="outline" fullWidth onClick={() => void goBackToSettings()}>
                    Cancel and change settings
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Card variant="hero">
        <h1>{isValidated ? 'Confirm your team' : 'Add Teams'}</h1>
        <p className={styles.subtitle}>{formData.name}</p>
        <img src="/register2.png" alt="Add Teams" />

        {!isLinked && (
          <div className={styles.linkSection}>
            <Button size="lg" variant="primary" onClick={handleHattrickLink} disabled={loading}>
              <Lineicons icon={HandShakeOutlined} size={20} />{' '}
              {isValidated ? 'Link with Hattrick' : 'Link Organizer Profile'}
            </Button>
            <p className={styles.linkInstruction}>
              {isValidated
                ? 'Link your Hattrick account to register your team for this tournament.'
                : 'Required to manage the tournament.'}
            </p>
          </div>
        )}

        {isValidated && isLinked && creator && (
          <div className={styles.creatorWelcome}>
            <h2>Ready to create</h2>
            <div className={styles.creatorTeamCard}>
              {creator.logoUrl && (
                <img src={creator.logoUrl} alt="" className={styles.creatorTeamLogo} />
              )}
              <p className={styles.small}>Your team</p>
              <strong>{creator.name}</strong>
              <span>
                {[creator.managerName, `ID ${creator.htId}`].filter(Boolean).join(' · ')}
              </span>
            </div>
            <p className={styles.finalizeNote}>
              Other managers join via the public link after the tournament is created.
            </p>
          </div>
        )}

        {!isValidated && isLinked && (
          <div className={styles.manualEntry}>
            <p className={styles.subtitle}>Add at least two teams. You can add more later.</p>
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
                  className={styles.readOnlyName}
                  required
                />
              </div>
              {newTeamId.length >= 6 && !newTeamName && (
                <button
                  type="button"
                  onClick={() => fetchTeamData(newTeamId)}
                  disabled={isFetchingTeamData}
                  className={styles.fetchIconBtn}
                  title="Get Team Data"
                >
                  <Lineicons icon={HandShakeOutlined} size={20} />
                </button>
              )}
              {newTeamName && (
                <Button type="submit" variant="secondary" size="md">
                  <Lineicons icon={PlusOutlined} size={20} /> Add
                </Button>
              )}
            </form>
          </div>
        )}

        {!isValidated && (
          <ul className={styles.teamList}>
            {teams.map((team) => (
              <li key={team.tempId} className={team.isCreator ? styles.creatorRow : undefined}>
                <div className={styles.teamInfo}>
                  <span className={styles.name}>
                    {team.name}
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
                {!team.isCreator && (
                  <button onClick={() => removeLocalTeam(team.tempId)} className={styles.deleteBtn}>
                    <Lineicons icon={Trash3Outlined} size={18} />
                  </button>
                )}
              </li>
            ))}
            {teams.length === 0 && <p className={styles.empty}>No teams added yet.</p>}
          </ul>
        )}

        <div className={styles.genActions}>
          <Button variant="secondary" size="lg" fullWidth onClick={handleFinalSubmit} disabled={loading || !canCreate}>
            <Lineicons icon={Trophy1Outlined} size={18} /> {loading ? 'Creating...' : 'Create Tournament'}
          </Button>
          <Button variant="outlineWhite" size="sm" onClick={() => setStep('info')} disabled={loading} style={{ opacity: 0.8 }}>
            Go Back
          </Button>
        </div>
      </Card>
    </div>
  );
};
