import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { trackActivity } from '../../hooks/useActivityTracking';
import { Tooltip } from 'react-tooltip';
import { nanoid } from 'nanoid';
import { Button } from '../../components/Button/Button';
import { HeroCard } from '../../components/Card/HeroCard';
import { Modal } from '../../components/Modal/Modal';
import { SidebarWidget } from '../../components/SidebarWidget/SidebarWidget';
import { CompactAccordionWidget } from '../../components/CompactAccordionWidget/CompactAccordionWidget';
import {
  X,
  ArrowClockwise,
  ArrowRight,
  Trophy,
  PencilSimple,
  CaretLeft,
  Trash,
  Link,
  FolderOpen,
  Question,
} from 'phosphor-react';
import {
  DESCRIPTIONS,
  TOURNAMENT_DEFAULT_120MIN_DEFAULTS,
  TOURNAMENT_NAMES,
  UNIVERSAL_TOURNAMENT_NAMES,
} from '../../constants/descriptions';
import { CREATION_TIPS } from '../../constants/creation-tips';
import { isAppg120ScoringMode } from '../../../shared/scoring-profile';
import {
  filterTeamsForCategory,
  getCompatibleLeagueRestrictionOptions,
  validateTeamEligibility,
  type LeagueCategory,
} from '../../utils/team-eligibility';
import { normalizeTournamentRegistrationType } from '../../utils/tournament-types';
import {
  fetchOpenTournaments,
  formatOpenTournamentMeta,
  type OpenTournamentSummary,
} from '../../utils/open-tournaments';
import styles from './CreateTournament.module.sass';
import { resolveCountryRestriction } from '../../../shared/worlddetails';
import { getCanonicalCountryName, getCountryFlagUrl, getLeagueFlagUrl } from '../../utils/ht-data';
import {
  formatTournamentName,
  formatTournamentSlug,
  hasCountryFlagSuffix,
  normalizeTournamentName,
  normalizeTournamentSlug,
} from '../../utils/tournament-names';
import {
  getRandomSandboxTeamId,
  SANDBOX_RANDOM_ATTEMPTS,
  SANDBOX_HFI_TEAM_ID_MAX,
  SANDBOX_HFI_TEAM_ID_MIN,
  SANDBOX_REGULAR_TEAM_ID_MAX,
  SANDBOX_REGULAR_TEAM_ID_MIN,
} from '../../constants/sandbox';

const HAS_CREATED_TOURNAMENT_KEY = 'ht120_has_created_tournament';

const SCORING_MODE_HELP: Record<string, string> = {
  '120min':
    '120-minute achievements: standings rank teams by how many completed friendlies reached 120 minutes. The match result itself does not award league points.',
  points: 'Regular 90-minute points: standard football scoring — 3 points for a win, 1 for a draw and 0 for a loss.',
  appg: "Average Points Per Game for 120-minute tournaments that do not follow a strict schedule (teams play different amount of games). Points are awarded based on 120 min matches, then team's total is divided by its completed matches.",
};

const CreationTipsWidget = () => (
  <CompactAccordionWidget title="Creation Tips" icon={<Question size={20} weight="bold" />} items={CREATION_TIPS} />
);

const SidebarContent = ({ openTournaments }: { openTournaments: OpenTournamentSummary[] }) => (
  <aside className={styles.sidebar}>
    <SidebarWidget title="Open Tournaments" icon={<FolderOpen size={20} weight="bold" />}>
      <ul className={styles.widgetList}>
        {openTournaments.map((tournament) => (
          <li key={tournament.id} className={styles.widgetItem}>
            <strong>
              <RouterLink to={`/t/${tournament.slug}`}>{tournament.name}</RouterLink>
            </strong>
            <span className={styles.widgetMeta}>
              <span>{formatOpenTournamentMeta(tournament)}</span>
              <RouterLink to={`/t/${tournament.slug}`} className={styles.joinLink}>
                Join <ArrowRight size={12} weight="bold" />
              </RouterLink>
            </span>
          </li>
        ))}
      </ul>
    </SidebarWidget>

    <CreationTipsWidget />
  </aside>
);

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
  countryId?: number;
  leagueId?: number;
  genderId?: number;
  leagueLevel?: number;
}

interface LinkedOrganizer {
  managerName: string;
  hattrickUserId: number | null;
}

const getRandomDescription = () => DESCRIPTIONS[Math.floor(Math.random() * DESCRIPTIONS.length)];
const getRandom120MinDefaultDescription = () =>
  TOURNAMENT_DEFAULT_120MIN_DEFAULTS[Math.floor(Math.random() * TOURNAMENT_DEFAULT_120MIN_DEFAULTS.length)];
const getRandomName = (mode: string) => {
  const pool = mode === 'points' ? UNIVERSAL_TOURNAMENT_NAMES : TOURNAMENT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
};
const normalizeSlugInput = (value: string) => normalizeTournamentSlug(value.trim());
const getSuggestedTournamentSlug = (name: string, registrationType?: string | null) =>
  formatTournamentSlug(name, normalizeTournamentRegistrationType(registrationType));
const formatEditableTournamentName = (
  name: string,
  options: {
    registrationType?: string | null;
    leagueCategory?: string | null;
    countryLimit?: string | number | null;
    includeCountryFlag?: boolean;
  },
) => {
  if (normalizeTournamentRegistrationType(options.registrationType) === 'sandbox') {
    return name;
  }

  return formatTournamentName(name, options);
};

const getInitialFormData = () => ({
  name: '',
  slug: '',
  scoring_mode: '120min',
  league_category: 'male',
  registration_type: localStorage.getItem(HAS_CREATED_TOURNAMENT_KEY) === 'true' ? 'validated' : 'sandbox',
  is_private: false,
  country_limit: '',
  include_country_flag: true,
  description: getRandom120MinDefaultDescription(),
  admin_email: '',
  max_teams: '' as string | number,
});

interface FetchedTeamData {
  teamId: number;
  teamName: string;
  logoUrl?: string;
  countryName?: string;
  countryId?: number;
  leagueId?: number;
  leagueSystemId?: number;
  leagueName?: string;
  genderId?: number;
  leagueLevel?: number;
}

export const CreateTournament: React.FC = () => {
  const navigate = useNavigate();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [openTournaments, setOpenTournaments] = useState<OpenTournamentSummary[]>([]);
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
    return getInitialFormData();
  });

  const [teams, setTeams] = useState<LocalTeam[]>(() => {
    const saved = localStorage.getItem('create_tournament_progress');
    return saved ? JSON.parse(saved).teams || [] : [];
  });

  const [organizerProfile, setOrganizerProfile] = useState<LinkedOrganizer | null>(() => {
    const saved = localStorage.getItem('create_tournament_progress');
    return saved ? JSON.parse(saved).organizerProfile || null : null;
  });

  const [showDescription, setShowDescription] = useState(() => {
    const saved = localStorage.getItem('create_tournament_progress');
    return saved ? (JSON.parse(saved).showDescription ?? true) : false;
  });

  const [showEmail, setShowEmail] = useState(() => {
    const saved = localStorage.getItem('create_tournament_progress');
    return saved ? (JSON.parse(saved).showEmail ?? false) : false;
  });

  const [showLeagueRestriction, setShowLeagueRestriction] = useState(() => {
    const saved = localStorage.getItem('create_tournament_progress');
    return saved ? !!JSON.parse(saved).formData.country_limit : false;
  });
  const [linkedManager, setLinkedManager] = useState<{
    selection_token: string;
    manager_name: string;
    access_token: string;
    access_token_secret: string;
    hattrick_user_id: number | null;
    teams_json: Array<{
      teamId: number;
      teamName: string;
      leagueId?: number;
      genderId?: number;
      leagueLevel?: number;
      leagueLevelUnitName?: string;
      regionName?: string;
      leagueName?: string;
      countryId?: number;
      countryName?: string;
    }>;
  } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const linkingParamsHandledRef = useRef(false);

  const [isLinked, setIsLinked] = useState(() => {
    const saved = localStorage.getItem('create_tournament_progress');
    if (!saved) return false;
    const progress = JSON.parse(saved);
    return !!progress.organizerProfile || !!progress.teams?.some((t: LocalTeam) => t.isCreator);
  });

  const saveProgress = useCallback(
    (
      updatedForm = formData,
      updatedTeams = teams,
      updatedShowDesc = showDescription,
      updatedShowEmail = showEmail,
      updatedOrganizerProfile = organizerProfile,
    ) => {
      localStorage.setItem(
        'create_tournament_progress',
        JSON.stringify({
          formData: updatedForm,
          teams: updatedTeams,
          showDescription: updatedShowDesc,
          showEmail: updatedShowEmail,
          organizerProfile: updatedOrganizerProfile,
        }),
      );
    },
    [formData, teams, showDescription, showEmail, organizerProfile],
  );

  const fetchPendingSession = useCallback(async (token: string) => {
    setShowModal(true);
    setModalLoading(true);

    const { data, error } = await supabase
      .from('oauth_temp_sessions')
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
  }, []);

  useEffect(() => {
    if (linkingParamsHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);

    const token = params.get('token');
    if (token) {
      linkingParamsHandledRef.current = true;
      setTimeout(() => {
        void fetchPendingSession(token);
      }, 0);
    }

    const error = params.get('error');
    if (error) {
      linkingParamsHandledRef.current = true;
      alert(decodeURIComponent(error));
    }
  }, [fetchPendingSession]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [step]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const tournaments = await fetchOpenTournaments();
        if (!cancelled) {
          setOpenTournaments(tournaments);
        }
      } catch (err) {
        console.error('Error fetching open tournaments:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const clearPendingJoin = async (selectionToken: string) => {
    await supabase.from('oauth_temp_sessions').delete().eq('selection_token', selectionToken);
  };

  const goBackToSettings = async () => {
    const token =
      linkedManager?.selection_token ?? new URLSearchParams(window.location.search).get('token') ?? undefined;
    if (token) await clearPendingJoin(token);

    setShowModal(false);
    setLinkedManager(null);
    setIsLinked(false);
    const withoutCreator = teams.filter((t) => !t.isCreator);
    setOrganizerProfile(null);
    setTeams(withoutCreator);
    setStep('info');
    saveProgress(formData, withoutCreator, showDescription, showEmail, null);
    window.history.replaceState({}, '', '/create');
  };

  const clearAll = () => {
    localStorage.removeItem('create_tournament_progress');
    setFormData(getInitialFormData());
    setTeams([]);
    setOrganizerProfile(null);
    setShowDescription(false);
    setShowEmail(false);
    setShowLeagueRestriction(false);
    setLinkedManager(null);
    setShowModal(false);
    setIsLinked(false);
    setStep('info');
    window.history.replaceState({}, '', '/create');
  };

  const fetchTeamLogoFromChpp = async (
    teamId: number,
  ): Promise<{
    logoUrl?: string;
    countryName?: string;
    countryId?: number;
    leagueId?: number;
    genderId?: number;
    leagueLevel?: number;
  }> => {
    try {
      const res = await fetch(`/api/teams/info?team_id=${teamId}`);
      if (!res.ok) return {};
      const data = await res.json();
      return {
        logoUrl: data.logoUrl ?? undefined,
        countryName: data.countryName ?? undefined,
        countryId: data.countryId ?? undefined,
        leagueId: data.leagueId ?? undefined,
        genderId: data.genderId ?? undefined,
        leagueLevel: data.leagueLevel ?? undefined,
      };
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

    setModalLoading(true);
    try {
      // 1. Check safeguard (already in another tournament?)
      const res = await fetch(`/api/teams/info?team_id=${team.teamId}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify team eligibility');
      }

      // 2. Fetch logo
      const { logoUrl, countryName, countryId, leagueId, genderId, leagueLevel } = await fetchTeamLogoFromChpp(
        team.teamId,
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
        logoUrl: logoUrl || undefined,
        countryId,
        countryName: countryName || undefined,
        leagueId,
        genderId,
        leagueLevel,
      };

      const updatedTeams =
        normalizeTournamentRegistrationType(formData.registration_type) === 'validated'
          ? [creatorTeam]
          : [...teams.filter((t) => !t.isCreator), creatorTeam];
      const updatedOrganizerProfile = {
        managerName: linkedManager.manager_name,
        hattrickUserId: linkedManager.hattrick_user_id,
      };

      setTeams(updatedTeams);
      setOrganizerProfile(updatedOrganizerProfile);
      setIsLinked(true);
      saveProgress(formData, updatedTeams, showDescription, showEmail, updatedOrganizerProfile);
      setShowModal(false);
      setLinkedManager(null);

      await clearPendingJoin(linkedManager.selection_token);
      window.history.replaceState({}, '', '/create?step=teams');
      window.location.reload();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'An unexpected error occurred during team selection');
    } finally {
      setModalLoading(false);
    }
  };

  const handleOrganizerNoJoin = async () => {
    if (!linkedManager) return;

    const updatedOrganizerProfile = {
      managerName: linkedManager.manager_name,
      hattrickUserId: linkedManager.hattrick_user_id,
    };

    if (linkedManager?.selection_token) {
      await clearPendingJoin(linkedManager.selection_token);
    }
    setOrganizerProfile(updatedOrganizerProfile);
    setIsLinked(true);
    setShowModal(false);
    setLinkedManager(null);
    saveProgress(formData, teams, showDescription, showEmail, updatedOrganizerProfile);
    window.history.replaceState({}, '', '/create?step=teams');
  };

  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamData, setNewTeamData] = useState<FetchedTeamData | null>(null);
  const [sandboxCandidate, setSandboxCandidate] = useState<FetchedTeamData | null>(null);
  const [sandboxEntryMode, setSandboxEntryMode] = useState<'random' | 'manual'>('random');
  const [isFetchingTeamData, setIsFetchingTeamData] = useState(false);
  const [sandboxFetchError, setSandboxFetchError] = useState('');

  const fetchTeamData = async (htId: string) => {
    if (!htId || htId.length < 6) return;
    setIsFetchingTeamData(true);
    try {
      const res = await fetch(`/api/teams/info?team_id=${htId}`);
      const data = (await res.json()) as FetchedTeamData & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to fetch team data');

      // Client-side validation against selected restrictions
      const validation = validateTeamEligibility(
        {
          leagueName: data.leagueName,
          leagueId: data.leagueId,
          leagueSystemId: data.leagueSystemId,
          countryId: data.countryId,
          countryName: data.countryName,
        },
        {
          category: formData.league_category as LeagueCategory,
          countryLimit: formData.country_limit || null,
        },
      );

      if (!validation.eligible) {
        throw new Error(validation.reason);
      }

      setNewTeamName(data.teamName);
      setNewTeamData(data);
    } catch (error: unknown) {
      if (error instanceof Error) {
        alert(error.message);
      } else {
        alert('An unexpected error occurred');
      }
    } finally {
      setIsFetchingTeamData(false);
    }
  };

  const getTeamSettingsMismatch = (
    team: LocalTeam,
    options: { leagueCategory?: string; countryLimit?: string | number | null } = {},
  ) => {
    const countryLimit = options.countryLimit ?? formData.country_limit;
    const validation = validateTeamEligibility(
      {
        leagueName: '',
        leagueId: team.leagueId,
        leagueSystemId: team.leagueId === 3000 || team.genderId === 2 ? 2 : undefined,
        genderId: team.genderId,
        countryId: team.countryId,
        countryName: team.countryName,
      },
      {
        category: (options.leagueCategory || formData.league_category) as LeagueCategory,
        countryLimit: countryLimit ? String(countryLimit) : null,
      },
    );

    return validation.eligible
      ? null
      : validation.reason || 'Team does not match the selected tournament restrictions.';
  };

  const getFirstTeamSettingsMismatch = (
    options: { leagueCategory?: string; countryLimit?: string | number | null } = {},
  ) => {
    for (const team of teams) {
      const mismatch = getTeamSettingsMismatch(team, options);
      if (mismatch) return `Team ${team.name} (${team.htId}) does not match this restriction. ${mismatch}`;
    }
    return null;
  };

  const leagueRestrictionOptions = getCompatibleLeagueRestrictionOptions(
    teams.map((team) => ({
      leagueName: '',
      leagueId: team.leagueId,
      leagueSystemId: team.leagueId === 3000 || team.genderId === 2 ? 2 : undefined,
      genderId: team.genderId,
      countryId: team.countryId,
      countryName: team.countryName,
    })),
    formData.league_category as LeagueCategory,
  );

  const fetchSandboxTeamById = async (teamId: number): Promise<FetchedTeamData> => {
    const params = new URLSearchParams({
      team_id: String(teamId),
      sandbox: '1',
      league_category: formData.league_category === 'hfi' ? 'hfi' : 'male',
    });
    const res = await fetch(`/api/teams/info?${params.toString()}`);
    const data = (await res.json()) as FetchedTeamData & { error?: string };
    if (!res.ok) throw new Error(data.error || 'Failed to fetch sandbox team data');
    if (!data.teamName || data.teamName === 'Unknown') throw new Error('Team data is missing a valid team name.');
    return data;
  };

  const fetchRandomSandboxTeam = async () => {
    setIsFetchingTeamData(true);
    setSandboxFetchError('');
    setSandboxCandidate(null);

    try {
      for (let attempt = 0; attempt < SANDBOX_RANDOM_ATTEMPTS; attempt += 1) {
        const teamId = getRandomSandboxTeamId(formData.league_category === 'hfi' ? 'hfi' : 'male');
        if (teams.some((team) => team.htId === String(teamId))) continue;

        try {
          const candidate = await fetchSandboxTeamById(teamId);
          if (!teams.some((team) => team.htId === String(candidate.teamId))) {
            setSandboxCandidate(candidate);
            return;
          }
        } catch {
          // Random team IDs are sparse; keep trying until the configured cap.
        }
      }

      setSandboxFetchError('Could not find a matching random team. Try again.');
    } finally {
      setIsFetchingTeamData(false);
    }
  };

  const fetchSandboxManualTeamData = async (htId: string) => {
    const teamId = Number(htId);
    if (!teamId || htId.length < 5) return;
    setIsFetchingTeamData(true);
    setSandboxFetchError('');
    try {
      const data = await fetchSandboxTeamById(teamId);
      if (teams.some((team) => team.htId === String(data.teamId))) {
        throw new Error('This Team ID is already in the list.');
      }
      setNewTeamName(data.teamName);
      setNewTeamData(data);
    } catch (error: unknown) {
      setNewTeamName('');
      setNewTeamData(null);
      setSandboxFetchError(error instanceof Error ? error.message : 'Could not fetch that test team.');
    } finally {
      setIsFetchingTeamData(false);
    }
  };

  const handleNameChange = (name: string) => {
    const slug = getSuggestedTournamentSlug(name, formData.registration_type);
    setFormData({
      ...formData,
      name,
      slug,
      ...(formData.country_limit ? { include_country_flag: hasCountryFlagSuffix(name, formData.country_limit) } : {}),
    });
  };

  const regenerateDescription = () => {
    const newDesc = getRandomDescription();
    const updatedForm = { ...formData, description: newDesc };
    setFormData(updatedForm);
    saveProgress(updatedForm);
    window.requestAnimationFrame(() => {
      const field = descriptionRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
  };

  const regenerateName = () => {
    const newName = getRandomName(formData.scoring_mode);
    handleNameChange(newName);
    window.requestAnimationFrame(() => {
      const field = nameInputRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
  };

  const checkSlugAvailability = async (requestedSlug?: string) => {
    const slug = normalizeSlugInput(requestedSlug || formData.slug || formData.name);
    if (!slug) {
      return formData;
    }

    const { data: matchingSlugs, error } = await supabase.from('tournaments').select('slug').like('slug', `${slug}%`);
    if (error) {
      throw error;
    }

    const usedSlugs = new Set((matchingSlugs ?? []).map((row) => row.slug));
    let availableSlug = slug;
    if (usedSlugs.has(availableSlug)) {
      let suffix = 2;
      while (usedSlugs.has(`${slug}-${suffix}`)) suffix += 1;
      availableSlug = `${slug}-${suffix}`;
    }

    const nextForm = availableSlug === formData.slug ? formData : { ...formData, slug: availableSlug };
    if (nextForm !== formData) setFormData(nextForm);
    return nextForm;
  };

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    if (!normalizeTournamentName(formData.name)) {
      alert('Tournament name must include at least one letter or number.');
      return;
    }

    let nextForm = formData;
    const nameSlug = getSuggestedTournamentSlug(formData.name, formData.registration_type);
    const currentSlug = normalizeSlugInput(formData.slug);
    const legacyNameSlug = normalizeSlugInput(formData.name);
    if (nameSlug && (!currentSlug || currentSlug === nameSlug || currentSlug === legacyNameSlug)) {
      try {
        nextForm = await checkSlugAvailability(nameSlug);
      } catch {
        alert('Could not check URL availability. Please try again.');
        return;
      }
    }

    setStep('teams');
    saveProgress(nextForm);
    window.history.replaceState({}, '', '/create?step=teams');
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
        logoUrl: newTeamData?.logoUrl,
        countryName: newTeamData?.countryName,
        countryId: newTeamData?.countryId,
        leagueId: newTeamData?.leagueId,
        genderId: newTeamData?.genderId,
        leagueLevel: newTeamData?.leagueLevel,
        managerName: newTeamData ? 'Bot team' : undefined,
      },
    ];
    setTeams(updatedTeams);
    saveProgress(formData, updatedTeams);
    setNewTeamId('');
    setNewTeamName('');
    setNewTeamData(null);
  };

  const addSandboxTeam = () => {
    if (!sandboxCandidate) return;
    if (teams.some((t) => t.htId === String(sandboxCandidate.teamId))) {
      alert('This Team ID is already in the list.');
      setSandboxCandidate(null);
      return;
    }

    const updatedTeams = [
      ...teams,
      {
        tempId: nanoid(),
        name: sandboxCandidate.teamName,
        htId: String(sandboxCandidate.teamId),
        logoUrl: sandboxCandidate.logoUrl,
        countryName: sandboxCandidate.countryName,
        countryId: sandboxCandidate.countryId,
        leagueId: sandboxCandidate.leagueId,
        genderId: sandboxCandidate.genderId,
        leagueLevel: sandboxCandidate.leagueLevel,
        managerName: 'Bot team',
      },
    ];
    setTeams(updatedTeams);
    saveProgress(formData, updatedTeams);
    setSandboxCandidate(null);
    setSandboxFetchError('');
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
    const registrationType = normalizeTournamentRegistrationType(formData.registration_type);
    const isValidated = registrationType === 'validated';
    const isSandbox = registrationType === 'sandbox';
    const organizerId = creator?.hattrickUserId ?? organizerProfile?.hattrickUserId ?? null;
    const organizerName = creator?.managerName ?? organizerProfile?.managerName ?? null;

    if (isValidated) {
      if (!creator) {
        alert('Link your Hattrick team to continue.');
        return;
      }
    } else if (isSandbox) {
      if (teams.length < 2) {
        alert('Add at least two sandbox teams.');
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

    const settingsMismatch = getFirstTeamSettingsMismatch();
    if (settingsMismatch) {
      alert(settingsMismatch);
      return;
    }

    setLoading(true);
    const tournamentName =
      registrationType === 'sandbox' ? formatTournamentName(formData.name, { registrationType }) : formData.name.trim();
    const nameSlug = getSuggestedTournamentSlug(tournamentName, registrationType);
    const enteredSlug = normalizeSlugInput(formData.slug);
    const isSuggestedSlug =
      !enteredSlug || enteredSlug === nameSlug || enteredSlug === normalizeSlugInput(formData.name);
    let slug = (isSuggestedSlug ? nameSlug : enteredSlug) || nanoid(10);
    const adminPassword = nanoid(8);
    let createdTournamentId: string | null = null;

    try {
      if (isSuggestedSlug && slug) {
        const { data: matchingSlugs, error: slugLookupError } = await supabase
          .from('tournaments')
          .select('slug')
          .like('slug', `${slug}%`);
        if (slugLookupError) throw slugLookupError;

        const usedSlugs = new Set((matchingSlugs ?? []).map((row) => row.slug));
        if (usedSlugs.has(slug)) {
          const baseSlug = slug;
          let suffix = 2;
          while (usedSlugs.has(`${baseSlug}-${suffix}`)) suffix += 1;
          slug = `${baseSlug}-${suffix}`;
          setFormData({ ...formData, slug });
          saveProgress({ ...formData, slug });
        }
      }

      const { data: tournament, error: tError } = await supabase
        .from('tournaments')
        .insert([
          {
            name: tournamentName,
            slug,
            scoring_mode: formData.scoring_mode,
            league_category: formData.league_category,
            registration_type: registrationType,
            admin_password: adminPassword,
            is_private: isSandbox ? true : formData.is_private,
            country_limit: isSandbox ? null : formData.country_limit || null,
            description: showDescription ? formData.description : null,
            admin_email: showEmail ? formData.admin_email : null,
            thumbnail_index: Math.floor(Math.random() * 17) + 1,
            max_teams: formData.max_teams ? Number(formData.max_teams) : null,

            season: 1,
            status: 'open',
            is_test: isSandbox,
            organizer_id: organizerId,
            organizer_name: organizerName,
          },
        ])
        .select()
        .single();

      if (tError) {
        // Handle specific Supabase error for unique constraint
        if (tError.code === '23505') {
          const duplicateName =
            tError.message?.includes('tournaments_name_normalized_unique') ||
            tError.message?.includes('A tournament with this name already exists');
          throw new Error(
            duplicateName
              ? 'A tournament with this name already exists. Please choose a different name.'
              : 'A tournament with this URL slug already exists. Please choose a different slug.',
          );
        }
        throw tError;
      }
      createdTournamentId = tournament.id;

      if (isSandbox) {
        const sandboxTeamIdMin =
          formData.league_category === 'hfi' ? SANDBOX_HFI_TEAM_ID_MIN : SANDBOX_REGULAR_TEAM_ID_MIN;
        const sandboxTeamIdMax =
          formData.league_category === 'hfi' ? SANDBOX_HFI_TEAM_ID_MAX : SANDBOX_REGULAR_TEAM_ID_MAX;
        const { error: sandboxError } = await supabase.from('sandbox_tournaments').insert({
          tournament_id: tournament.id,
          team_id_min: sandboxTeamIdMin,
          team_id_max: sandboxTeamIdMax,
        });
        if (sandboxError) throw sandboxError;
      }

      const teamsToInsert = teams.map((t) => ({
        tournament_id: tournament.id,
        name: t.name,
        ht_team_id: parseInt(t.htId, 10),
        active: true,
        joined_via_oauth: !!t.isCreator,
        oauth_token: t.accessToken || null,
        oauth_token_secret: t.accessTokenSecret || null,
        manager_name: t.managerName || null,
        hattrick_user_id: t.hattrickUserId || null,
        logo_url: t.logoUrl || null,
        country_id: t.countryId ?? null,
        country_name: t.countryName || null,
        league_id: t.leagueId ?? null,
        gender_id: t.genderId ?? null,
        league_level: t.leagueLevel ?? null,
      }));

      const { error: teamsError } = await supabase.from('teams').insert(teamsToInsert);
      if (teamsError) throw teamsError;

      const { error: chatSeedError } = await supabase.from('tournament_chat').insert({
        tournament_id: tournament.id,
        author_name: 'Tournament Administration',
        author_ht_id: 0,
        content: 'This is tournament chat. Login and say hello to everybody!',
      });
      if (chatSeedError) {
        console.warn('Tournament chat welcome message could not be seeded.', chatSeedError);
      }

      if (organizerId) {
        localStorage.setItem('my_ht_user_id', organizerId.toString());
      }
      if (organizerName) {
        localStorage.setItem('my_ht_manager_name', organizerName);
      }
      if (creator?.name) {
        localStorage.setItem('my_ht_team_name', creator.name);
      }

      localStorage.removeItem('create_tournament_progress');
      localStorage.setItem(HAS_CREATED_TOURNAMENT_KEY, 'true');
      localStorage.setItem(`admin_pw_${slug}`, adminPassword);
      void trackActivity('tournament_created', {
        route: '/create',
        tournamentId: tournament.id,
        metadata: { registrationType, isSandbox },
      });
      window.location.href = `/t/${slug}?tab=standings&welcome=created`;
    } catch (err: unknown) {
      if (createdTournamentId) {
        await supabase.from('teams').delete().eq('tournament_id', createdTournamentId);
        await supabase.from('sandbox_tournaments').delete().eq('tournament_id', createdTournamentId);
        await supabase.from('tournaments').delete().eq('id', createdTournamentId);
      }

      const message = err instanceof Error ? err.message : 'Unknown error';
      const friendlyMessage = message.includes("Could not find the table 'public.sandbox_tournaments'")
        ? 'Sandbox tournaments are not enabled in the database yet. Apply migration 053_sandbox_tournaments.sql and try again.'
        : message;
      alert('Error creating tournament: ' + friendlyMessage);
      setLoading(false);
    }
  };

  const creator = teams.find((t) => t.isCreator);
  const registrationType = normalizeTournamentRegistrationType(formData.registration_type);
  const isValidated = registrationType === 'validated';
  const isSandbox = registrationType === 'sandbox';
  const canCreate = isValidated ? !!creator : isSandbox ? teams.length >= 2 : isLinked && teams.length >= 2;
  const leagueRestrictionLabel = formData.league_category === 'hfi' ? 'Only HFI teams' : 'Any male';
  const countryRestrictionLabel = isSandbox
    ? 'Any country'
    : formData.country_limit
      ? resolveCountryRestriction(formData.country_limit)?.leagueName || formData.country_limit
      : 'Any country';
  const teamLimitLabel = formData.max_teams ? `${teams.length} of ${Number(formData.max_teams)} filled` : 'Unlimited';
  const sandboxTeamLimit = formData.max_teams ? Number(formData.max_teams) : null;
  const sandboxTeamLimitReached = isSandbox && sandboxTeamLimit !== null && teams.length >= sandboxTeamLimit;
  const sandboxRandomLabel = sandboxTeamLimit
    ? `Get random (${Math.min(teams.length, sandboxTeamLimit)} of ${sandboxTeamLimit})`
    : 'Get random';
  const restrictionsSummary = `League type: ${leagueRestrictionLabel}, Country limit: ${countryRestrictionLabel}, Team limit: ${teamLimitLabel}.`;
  const teamStepHelper = isValidated
    ? `First link your Hattrick account to register your team for this tournament.`
    : isSandbox
      ? `Add at least two random test teams. They use real Hattrick metadata but no real manager joins this tournament. ${restrictionsSummary}`
      : isLinked
        ? `Add at least two teams to get started. You can add more later.`
        : 'Now link your Hattrick account to manage this tournament.';

  if (step === 'info') {
    return (
      <div className={styles.wrapper}>
        <div className={styles.main}>
          <div className={styles.container}>
            <div className={styles.headerRow}>
              <button className={styles.closeBtn} onClick={() => navigate('/')}>
                <X size={36} weight="bold" />
              </button>
            </div>
            <HeroCard>
              <h1>Create Tournament</h1>
              <img src="/create.png" alt="HT-120min" />
              <form onSubmit={handleContinue} className={styles.form}>
                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label htmlFor="tournament_name">Tournament Name</label>
                    <button
                      type="button"
                      onClick={regenerateName}
                      className={styles.iconBtn}
                      data-tooltip-id="regenerate-tooltip"
                      aria-label="Regenerate name"
                    >
                      <ArrowClockwise size={20} weight="bold" />
                    </button>
                  </div>
                  <input
                    id="tournament_name"
                    name="tournament_name"
                    type="text"
                    ref={nameInputRef}
                    required
                    value={formData.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g. Awesome Great Tournament S1 ⭐️"
                    autoFocus
                  />
                  {formData.country_limit && (
                    <label className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={formData.include_country_flag !== false}
                        onChange={(e) => {
                          const includeCountryFlag = e.target.checked;
                          setFormData({
                            ...formData,
                            include_country_flag: includeCountryFlag,
                            name: formatEditableTournamentName(formData.name, {
                              registrationType: formData.registration_type,
                              leagueCategory: formData.league_category,
                              countryLimit: formData.country_limit,
                              includeCountryFlag,
                            }),
                          });
                        }}
                      />
                      Include flag/suffix
                    </label>
                  )}
                </div>
                <div className={styles.field}>
                  <label htmlFor="tournament_slug">Unique URL Slug</label>
                  <input
                    id="tournament_slug"
                    name="tournament_slug"
                    type="text"
                    value={formData.slug}
                    onChange={(e) => {
                      setFormData({ ...formData, slug: normalizeSlugInput(e.target.value) });
                    }}
                    placeholder="e.g. guam-hfi-s1"
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="league_category">Regular or Femme</label>
                  <select
                    id="league_category"
                    value={formData.league_category}
                    onChange={(e) => {
                      const leagueCategory = e.target.value as LeagueCategory;
                      const nextRestrictions = getCompatibleLeagueRestrictionOptions(
                        teams.map((team) => ({
                          leagueName: '',
                          leagueId: team.leagueId,
                          leagueSystemId: team.leagueId === 3000 || team.genderId === 2 ? 2 : undefined,
                          genderId: team.genderId,
                          countryId: team.countryId,
                          countryName: team.countryName,
                        })),
                        leagueCategory,
                      );
                      const countryLimit = nextRestrictions.some((option) => option.value === formData.country_limit)
                        ? formData.country_limit
                        : '';
                      const mismatch = getFirstTeamSettingsMismatch({ leagueCategory, countryLimit });
                      if (mismatch) {
                        alert(mismatch);
                        return;
                      }
                      setFormData({
                        ...formData,
                        league_category: leagueCategory,
                        country_limit: countryLimit,
                        name: formatEditableTournamentName(formData.name, {
                          registrationType: formData.registration_type,
                          leagueCategory,
                          countryLimit,
                          includeCountryFlag: formData.include_country_flag,
                        }),
                      });
                    }}
                  >
                    <option value="male">Regular league</option>
                    <option value="hfi">Hattrick Femme International (HFI) 💃🏻</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="registration_type">Tournament Type</label>
                  <select
                    id="registration_type"
                    value={formData.registration_type}
                    onChange={(e) => {
                      const nextType = normalizeTournamentRegistrationType(e.target.value);
                      const nextScoringMode =
                        nextType === 'validated' && isAppg120ScoringMode(formData.scoring_mode)
                          ? '120min'
                          : formData.scoring_mode;
                      const currentSlug = normalizeSlugInput(formData.slug);
                      const currentSuggestedSlug = getSuggestedTournamentSlug(
                        formData.name,
                        formData.registration_type,
                      );
                      const isGeneratedSlug =
                        !currentSlug ||
                        currentSlug === currentSuggestedSlug ||
                        currentSlug === normalizeSlugInput(formData.name);
                      const nextName = formatEditableTournamentName(formData.name, {
                        registrationType: nextType,
                        leagueCategory: formData.league_category,
                        countryLimit: nextType === 'sandbox' ? '' : formData.country_limit,
                        includeCountryFlag: formData.include_country_flag,
                      });
                      setFormData({
                        ...formData,
                        registration_type: nextType,
                        scoring_mode: nextScoringMode,
                        is_private: nextType === 'sandbox' ? true : formData.is_private,
                        country_limit: nextType === 'sandbox' ? '' : formData.country_limit,
                        name: nextName,
                        slug: isGeneratedSlug ? getSuggestedTournamentSlug(nextName, nextType) : formData.slug,
                      });
                      setNewTeamId('');
                      setNewTeamName('');
                      setNewTeamData(null);
                      setSandboxCandidate(null);
                    }}
                  >
                    <option value="validated">Hattrick Automated (CHPP) ✅</option>
                    <option value="manual">Organizer-Managed 📂</option>
                    <option value="sandbox">Dummy Test Tournament 🎳</option>
                  </select>
                  <p className={styles.small}>
                    {registrationType === 'validated'
                      ? 'Only managers themselves can join with their teams. Automated fixtures and scoring. Managers still arrange their own matches'
                      : registrationType === 'sandbox'
                        ? "Create a temporary test tournament with random dummy Hattrick teams. Real teams cannot be added. Test tourneys aren't published. But you can share the link around for others to look."
                        : "Organiser has more freedom — can add any Hattrick team they want that's available. Can self update scores. Useful when tournament management happens on HT forums. Manager does more, participants less."}
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
                    <option value="120min">Rank by 120 minute achievements ⏱</option>
                    <option value="points">Regular 90 min friendlies (3p/1p/0) 🥇</option>
                    {registrationType !== 'validated' && (
                      <option value="appg">APPG-120 (120 min event-based average points) 📊</option>
                    )}
                  </select>
                  <p className={styles.small}>{SCORING_MODE_HELP[formData.scoring_mode]}</p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="max_teams">Max Teams</label>
                  <select
                    id="max_teams"
                    value={formData.max_teams}
                    onChange={(e) => setFormData({ ...formData, max_teams: e.target.value })}
                  >
                    <option value="">Unlimited&#32; (decide later)</option>
                    {[2, 4, 6, 8, 16, 32, 64].map((n) => (
                      <option key={n} value={n}>
                        {n} teams
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={showDescription}
                        onChange={(e) => setShowDescription(e.target.checked)}
                      />
                      Tournament Description
                    </label>
                    {showDescription && (
                      <button
                        type="button"
                        onClick={regenerateDescription}
                        className={styles.iconBtn}
                        data-tooltip-id="regenerate-tooltip"
                        aria-label="Regenerate description"
                      >
                        <ArrowClockwise size={20} weight="bold" />
                      </button>
                    )}
                  </div>
                  {showDescription && (
                    <textarea
                      ref={descriptionRef}
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Tell participants about the tournament..."
                      rows={4}
                      className={styles.textarea}
                    />
                  )}
                </div>
                <Tooltip id="regenerate-tooltip" content="Shuffle from pool" delayShow={800} className="tooltip" />
                {!isSandbox && (
                  <div className={styles.field}>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={showLeagueRestriction}
                        onChange={(e) => {
                          setShowLeagueRestriction(e.target.checked);
                          if (!e.target.checked) {
                            setFormData({
                              ...formData,
                              country_limit: '',
                              name: formatEditableTournamentName(formData.name, {
                                registrationType: formData.registration_type,
                                leagueCategory: formData.league_category,
                                countryLimit: '',
                                includeCountryFlag: formData.include_country_flag,
                              }),
                            });
                          }
                        }}
                      />
                      Limited to one league/country
                    </label>
                    {showLeagueRestriction && (
                      <select
                        id="tournament_country_limit"
                        value={formData.country_limit}
                        onChange={(e) => {
                          const countryLimit = e.target.value;
                          if (countryLimit) {
                            const mismatch = getFirstTeamSettingsMismatch({ countryLimit });
                            if (mismatch) {
                              alert(mismatch);
                              return;
                            }
                          }
                          setFormData({
                            ...formData,
                            country_limit: countryLimit,
                            name: formatEditableTournamentName(formData.name, {
                              registrationType: formData.registration_type,
                              leagueCategory: formData.league_category,
                              countryLimit,
                              includeCountryFlag: formData.include_country_flag,
                            }),
                          });
                        }}
                        className={`${styles.mt05} ${styles.w100}`}
                      >
                        <option value="">Select league...</option>
                        {leagueRestrictionOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                <div className={styles.field}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={isSandbox || formData.is_private}
                      disabled={isSandbox}
                      onChange={(e) => setFormData({ ...formData, is_private: e.target.checked })}
                    />
                    {isSandbox
                      ? 'Sandbox tournaments are unlisted by default'
                      : 'Unlisted tournament (accessed via link)'}
                  </label>
                </div>
                <div className={styles.field}>
                  <label className={styles.checkboxLabel}>
                    <input type="checkbox" checked={showEmail} onChange={(e) => setShowEmail(e.target.checked)} />
                    Recovery email address (recommended)
                  </label>
                  {showEmail && (
                    <input
                      type="email"
                      value={formData.admin_email}
                      onChange={(e) => setFormData({ ...formData, admin_email: e.target.value })}
                      placeholder="In case you forget your admin password..."
                      className={`${styles.magicInput} ${styles.mt05}`}
                    />
                  )}
                </div>

                <div className={styles.actions}>
                  <Button type="submit" fullWidth disabled={loading} variant="secondary">
                    Continue <ArrowRight size={18} weight="bold" />
                  </Button>
                  <Button
                    type="button"
                    variant="outlineWhite"
                    size="sm"
                    onClick={clearAll}
                    disabled={loading}
                    className={styles.opacity08}
                  >
                    Clear All
                  </Button>
                </div>
              </form>
            </HeroCard>
          </div>
        </div>
        <SidebarContent openTournaments={openTournaments} />
      </div>
    );
  }

  const categoryLabel = formData.league_category === 'hfi' ? 'HFI' : 'Regular male';
  const leagueCategory = (formData.league_category === 'hfi' ? 'hfi' : 'male') as LeagueCategory;
  const eligibleTeams = linkedManager ? filterTeamsForCategory(linkedManager.teams_json, leagueCategory) : [];

  if (showModal) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.main}>
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
                        A self-organized cup you can join with one of your teams, or organize it without playing. These
                        teams are eligible for this cup.
                      </p>
                    ) : eligibleTeams.length === 1 ? (
                      <p>
                        You have one team eligible for a <strong>{categoryLabel}</strong> tournament. Select it to
                        continue.
                      </p>
                    ) : (
                      <p>
                        Choose which team will join this <strong>{categoryLabel}</strong> tournament. Other managers
                        join themselves via the public link later.
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
                          <CaretLeft size={20} weight="bold" className="r-180" />
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
        </div>
        <SidebarContent openTournaments={openTournaments} />
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.main}>
        <div className={styles.container}>
          <div className={styles.headerRow}>
            <button className={styles.closeBtn} onClick={() => navigate('/')}>
              <X size={36} weight="bold" />
            </button>
          </div>
          <HeroCard>
            <h1>{isValidated ? 'Confirm your team' : isSandbox ? 'Build a test tournament' : 'Add Teams'}</h1>
            <img src="/register2.png" alt="Add Teams" />
            <h2 className={styles.teamStepTitle}>{formData.name}</h2>
            <p className={styles.small}>/{formData.slug}</p>
            <p className={styles.teamStepHelper}>{teamStepHelper}</p>

            {!isSandbox && !isLinked && (
              <div className={styles.linkSection}>
                <Button size="lg" variant="primary" onClick={handleHattrickLink} disabled={loading}>
                  <ArrowRight size={20} weight="bold" /> {isValidated ? 'Link with Hattrick' : 'Link Organizer Profile'}
                </Button>
              </div>
            )}

            {isValidated && isLinked && creator && (
              <div className={styles.creatorWelcome}>
                <div className={styles.welcomeHeader}>
                  <h2>Ready to create</h2>
                </div>
                <div className={styles.creatorTeamCard}>
                  {creator.logoUrl && <img src={creator.logoUrl} alt="" className={styles.creatorTeamLogo} />}
                  <div className={styles.creatorCardContent}>
                    <p className={styles.small}>Your team</p>
                    <strong>{creator.name}</strong>
                    <span>{[creator.managerName, `ID ${creator.htId}`].filter(Boolean).join(' · ')}</span>
                  </div>
                  <button className={styles.removeCreatorBtnInline} onClick={goBackToSettings} title="Remove team">
                    <X size={20} weight="bold" />
                  </button>
                </div>
                <p className={styles.finalizeNote}>
                  Other managers join via the public link after the tournament is created.
                </p>
              </div>
            )}

            {!isValidated && !isSandbox && isLinked && (
              <div className={styles.manualEntry}>
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
                        setNewTeamData(null);
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
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => fetchTeamData(newTeamId)}
                      disabled={isFetchingTeamData}
                      title="Get Team Data"
                    >
                      Get Data
                    </Button>
                  )}
                  {newTeamName && (
                    <Button type="submit" variant="secondary" size="md">
                      Add it
                    </Button>
                  )}
                </form>
              </div>
            )}

            {isSandbox && (
              <div className={styles.manualEntry}>
                {sandboxEntryMode === 'random' ? (
                  <>
                    {!sandboxCandidate && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="lg"
                          onClick={fetchRandomSandboxTeam}
                          disabled={isFetchingTeamData || sandboxTeamLimitReached}
                        >
                          {isFetchingTeamData ? 'Finding a team...' : sandboxRandomLabel}
                        </Button>
                        <button
                          type="button"
                          className={styles.selectorSwitch}
                          onClick={() => {
                            setSandboxEntryMode('manual');
                            setSandboxCandidate(null);
                            setSandboxFetchError('');
                          }}
                        >
                          Add teams manually instead.
                        </button>
                      </>
                    )}
                    {sandboxCandidate && (
                      <div className={styles.sandboxCandidate}>
                        {sandboxCandidate.logoUrl && (
                          <img src={sandboxCandidate.logoUrl} alt="" className={styles.creatorTeamLogo} />
                        )}
                        <div className={styles.creatorCardContent}>
                          <strong>{sandboxCandidate.teamName}</strong>
                          <span>
                            {[
                              `ID ${sandboxCandidate.teamId}`,
                              sandboxCandidate.countryName,
                              sandboxCandidate.leagueId !== sandboxCandidate.countryId && sandboxCandidate.leagueName,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                        <div className={styles.sandboxCandidateActions}>
                          <Button type="button" variant="secondary" size="sm" onClick={addSandboxTeam}>
                            Add it
                          </Button>
                          <Button
                            type="button"
                            variant="outlineWhite"
                            size="sm"
                            onClick={fetchRandomSandboxTeam}
                            disabled={isFetchingTeamData}
                          >
                            Retry
                          </Button>
                        </div>
                        <button
                          type="button"
                          className={styles.sandboxCandidateClose}
                          onClick={() => {
                            setSandboxCandidate(null);
                            setSandboxFetchError('');
                          }}
                          disabled={isFetchingTeamData}
                          aria-label="Close random team selector"
                        >
                          <X size={18} weight="bold" />
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <form onSubmit={addLocalTeam} className={styles.teamForm}>
                      <div className={styles.inputGroup}>
                        <input
                          name="sandbox_team_ht_id"
                          type="text"
                          placeholder="HT Team ID"
                          value={newTeamId}
                          onChange={(e) => {
                            setNewTeamId(e.target.value.replace(/\D/g, ''));
                            setNewTeamName('');
                            setNewTeamData(null);
                            setSandboxFetchError('');
                          }}
                          minLength={5}
                          maxLength={9}
                          required
                        />
                        <input
                          name="sandbox_team_name"
                          type="text"
                          placeholder="Team Name"
                          value={newTeamName}
                          readOnly
                          className={styles.readOnlyName}
                          required
                        />
                      </div>
                      {newTeamId.length >= 5 && !newTeamName && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => fetchSandboxManualTeamData(newTeamId)}
                          disabled={isFetchingTeamData || sandboxTeamLimitReached}
                          title="Get Team Data"
                        >
                          {isFetchingTeamData ? 'Getting data...' : 'Get Data'}
                        </Button>
                      )}
                      {newTeamName && (
                        <Button type="submit" variant="secondary" size="md" disabled={sandboxTeamLimitReached}>
                          Add it
                        </Button>
                      )}
                    </form>
                    <button
                      type="button"
                      className={styles.selectorSwitch}
                      onClick={() => {
                        setSandboxEntryMode('random');
                        setNewTeamId('');
                        setNewTeamName('');
                        setNewTeamData(null);
                        setSandboxFetchError('');
                      }}
                    >
                      Switch to random team selector
                    </button>
                  </>
                )}
                {sandboxFetchError && <p className={styles.empty}>{sandboxFetchError}</p>}
              </div>
            )}

            {!isValidated && (
              <ul className={styles.teamList}>
                {teams.map((team) => {
                  const displayCountryName = getCanonicalCountryName(team.countryName, team.countryId);
                  const countryFlagUrl = getCountryFlagUrl(team.countryId, team.countryName);
                  const leagueFlagUrl = getLeagueFlagUrl(team.leagueId);

                  return (
                    <li key={team.tempId} className={team.isCreator ? styles.creatorRow : undefined}>
                      <div className={styles.teamIdentity}>
                        {team.logoUrl && <img src={team.logoUrl} alt="" className={styles.teamLogo} />}
                        <div className={styles.teamInfo}>
                          <span className={styles.name}>
                            <span className={styles.teamNameText}>{team.name}</span>
                            {team.isCreator && <span className={styles.creatorBadge}>(You)</span>}
                            <a
                              href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.htId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.htLink}
                            >
                              <Link size={16} weight="bold" />
                            </a>
                          </span>
                          <span className={styles.teamMeta}>
                            {leagueFlagUrl && (
                              <img src={leagueFlagUrl} alt="League" className={styles.teamFlag} loading="lazy" />
                            )}
                            {countryFlagUrl && (
                              <img
                                src={countryFlagUrl}
                                alt={displayCountryName || 'Country'}
                                className={styles.teamFlag}
                                loading="lazy"
                              />
                            )}
                            <span>ID: {team.htId}</span>
                          </span>
                        </div>
                      </div>
                      <div className={styles.teamActions}>
                        <button
                          onClick={() => (team.isCreator ? goBackToSettings() : removeLocalTeam(team.tempId))}
                          className={styles.deleteBtn}
                        >
                          {team.isCreator ? <X size={18} weight="bold" /> : <Trash size={18} weight="bold" />}
                        </button>
                      </div>
                    </li>
                  );
                })}
                {teams.length === 0 && <p className={styles.empty}>No teams added yet.</p>}
              </ul>
            )}

            <div className={styles.genActions}>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={handleFinalSubmit}
                disabled={loading || !canCreate}
              >
                {isSandbox ? <PencilSimple size={18} weight="bold" /> : <Trophy size={18} weight="bold" />}
                {loading ? 'Creating...' : isSandbox ? 'Create Test Tournament' : 'Create Tournament'}
              </Button>
              <Button
                variant="outlineWhite"
                size="sm"
                onClick={() => {
                  setStep('info');
                  window.history.replaceState({}, '', '/create');
                }}
                disabled={loading}
                className={styles.opacity08}
              >
                Go Back
              </Button>
            </div>
          </HeroCard>
        </div>
      </div>
      <SidebarContent openTournaments={openTournaments} />
    </div>
  );
};
