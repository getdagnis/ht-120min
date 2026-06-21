import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import type { MatchmakerRequest } from '../../utils/matchmaker';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { TeamSelectorModal } from '../../components/TeamSelectorModal/TeamSelectorModal';
import { Avatar } from '../../components/Avatar/Avatar';
import { Handshake, X, Heart, Clock, Info, Warning, ArrowsOut, Trophy, CaretLeft, CaretRight } from 'phosphor-react';
import styles from './Matchmaker.module.sass';

interface ChppTeamOption {
  teamId: number;
  teamName: string;
  logo_url?: string | null;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryName?: string;
  leagueId?: number;
  leagueSystemId?: number;
  leagueName?: string;
  availabilityStatus?: 'available' | 'booked' | 'unavailable' | 'unknown';
  availabilityReason?: string;
  genderId?: number;
}

const normalizeTeamList = (teams: ChppTeamOption[]) =>
  teams.map((team) => ({
    ...team,
    availabilityStatus: team.availabilityStatus ?? 'unknown',
  }));

const availabilityPriority: Record<NonNullable<ChppTeamOption['availabilityStatus']>, number> = {
  available: 0,
  booked: 1,
  unavailable: 2,
  unknown: 3,
};

const getAvailabilityGroupLabel = (status: NonNullable<ChppTeamOption['availabilityStatus']>) => {
  if (status === 'available') return 'Available Now';
  if (status === 'booked') return 'Booked';
  if (status === 'unknown') return 'Unknown';
  return 'Unavailable';
};

const getAvailabilityStatusLabel = (team: ChppTeamOption) => {
  if (team.availabilityStatus === 'available') return 'Available now';
  if (team.availabilityStatus === 'booked') return 'Booked';
  if (team.availabilityStatus === 'unknown') return 'Unknown';
  return 'Unavailable';
};

const groupTeamsByAvailability = (teams: ChppTeamOption[]) => {
  const groups = [
    { status: 'available' as const, teams: [] as ChppTeamOption[] },
    { status: 'booked' as const, teams: [] as ChppTeamOption[] },
    { status: 'unavailable' as const, teams: [] as ChppTeamOption[] },
    { status: 'unknown' as const, teams: [] as ChppTeamOption[] },
  ];

  teams.forEach((team) => {
    const status = team.availabilityStatus ?? 'unknown';
    const group = groups.find((item) => item.status === status) ?? groups[3];
    group.teams.push(team);
  });

  return groups
    .map((group) => ({
      ...group,
      teams: group.teams.sort((a, b) => a.teamName.localeCompare(b.teamName)),
    }))
    .filter((group) => group.teams.length > 0)
    .sort((a, b) => availabilityPriority[a.status] - availabilityPriority[b.status]);
};

const clampScore = (value: number) => Math.max(0, Math.min(100, value));

const getFreshnessLabel = (request: MatchmakerRequest, nowMs: number) => {
  const ageHours = (nowMs - new Date(request.created_at).getTime()) / (1000 * 60 * 60);

  if (request.status !== 'open') {
    return {
      label: 'Booked',
      tone: 'bad' as const,
    };
  }

  if (ageHours < 12) {
    return {
      label: 'Posted today',
      tone: 'good' as const,
    };
  }

  if (ageHours < 72) {
    return {
      label: 'Posted this week',
      tone: 'warn' as const,
    };
  }

  return {
    label: 'Older listing',
    tone: 'bad' as const,
  };
};

const isVenueComplementary = (a: MatchmakerRequest['home_away'], b: MatchmakerRequest['home_away']) =>
  (a === 'home' && b === 'away') || (a === 'away' && b === 'home') || a === 'any' || b === 'any';

const isLocationCompatible = (a: MatchmakerRequest, b: MatchmakerRequest) => {
  const sameCountry = !!a.team?.country_name && a.team.country_name === b.team?.country_name;
  const differentCountry = !!a.team?.country_name && !!b.team?.country_name && !sameCountry;

  if (a.opponent_location === 'any' || b.opponent_location === 'any') return true;
  if (a.opponent_location === 'domestic' && b.opponent_location === 'domestic') return sameCountry;
  if (a.opponent_location === 'international_only' && b.opponent_location === 'international_only')
    return differentCountry;
  if (a.opponent_location === 'domestic') return sameCountry;
  if (b.opponent_location === 'domestic') return sameCountry;
  if (a.opponent_location === 'international_only') return differentCountry;
  if (b.opponent_location === 'international_only') return differentCountry;
  return false;
};

const getCompatibilityScore = (myAd: MatchmakerRequest | null, target: MatchmakerRequest) => {
  if (!myAd) {
    return { score: 0, labels: [] as string[] };
  }

  const labels: string[] = [];
  let score = 0;

  if (myAd.match_type === target.match_type) {
    score += 30;
    labels.push('120 min compatible');
  } else if (myAd.match_type === '90min_acceptable' || target.match_type === '90min_acceptable') {
    score += 18;
    labels.push('90 min acceptable');
  }

  if (isVenueComplementary(myAd.home_away, target.home_away)) {
    score += myAd.home_away === target.home_away || myAd.home_away === 'any' || target.home_away === 'any' ? 10 : 25;
    labels.push('Venue preference compatible');
  }

  if (isLocationCompatible(myAd, target)) {
    score += 25;
    labels.push('Location preference compatible');
  }

  if (myAd.is_long_term && target.is_long_term) {
    score += 12;
    labels.push('Long-term preference compatible');
  } else if (myAd.is_long_term || target.is_long_term) {
    score += 6;
    labels.push('Long-term preference possible');
  }

  if (myAd.is_back_and_forth && target.is_back_and_forth) {
    score += 8;
    labels.push('Back-and-forth preference compatible');
  } else if (myAd.is_back_and_forth || target.is_back_and_forth) {
    score += 4;
    labels.push('Back-and-forth preference possible');
  }

  return { score: clampScore(score), labels };
};

const getTeamFitScore = (selectedTeam: ChppTeamOption | undefined, target: MatchmakerRequest) => {
  if (!selectedTeam) {
    return { score: 0, labels: [] as string[] };
  }

  const labels: string[] = [];
  let score = 35;

  if (target.match_type === '120min') {
    score += 25;
    labels.push('120 min compatible');
  } else {
    score += 12;
    labels.push('90 min acceptable');
  }

  if (selectedTeam.countryName && target.team?.country_name) {
    const sameCountry = selectedTeam.countryName === target.team.country_name;
    const differentCountry = !sameCountry;

    if (target.opponent_location === 'domestic' && sameCountry) {
      score += 25;
      labels.push('Location preference compatible');
    } else if (target.opponent_location === 'international_only' && differentCountry) {
      score += 20;
      labels.push('Location preference compatible');
    } else if (target.opponent_location === 'any') {
      score += 12;
      labels.push('Location preference flexible');
    }
  }

  if (selectedTeam.genderId === target.gender_id) {
    score += 15;
    labels.push(selectedTeam.genderId === 0 ? 'HFI compatible' : 'Male compatible');
  }

  if (target.is_long_term) {
    score += 8;
    labels.push('Long-term preference compatible');
  }

  if (target.is_back_and_forth) {
    score += 6;
    labels.push('Back-and-forth preference compatible');
  }

  return { score: clampScore(score), labels };
};

export const Matchmaker: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [nowMs] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState<'browse' | 'my-requests' | 'hfi'>('browse');
  const [requests, setRequests] = useState<MatchmakerRequest[]>([]);
  const isDev = import.meta.env.VITE_MATCHMAKER_DEV_MODE === 'true' || window.location.hostname === 'localhost';
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [myRequests, setMyRequests] = useState<MatchmakerRequest[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Persistent tracking of own ads to hide them instantly
  const [locallyHiddenRequestIds, setLocallyHiddenRequestIds] = useState<Set<string>>(() => {
    const stored = sessionStorage.getItem('ht_hidden_own_ads');
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });

  const hideRequestIdLocally = useCallback((id: string) => {
    setLocallyHiddenRequestIds((prev) => {
      const next = new Set(prev).add(id);
      sessionStorage.setItem('ht_hidden_own_ads', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const [impersonatedManagerId] = useState<string>('');
  const [myTeams, setMyTeams] = useState<ChppTeamOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsWarning, setTeamsWarning] = useState<string | null>(null);
  const [selectedHtTeamId, setSelectedHtTeamId] = useState<number>(0);
  const [matchType, setMatchType] = useState<'120min' | '90min_acceptable'>('120min');
  const [location, setLocation] = useState<'domestic' | 'international_only' | 'any'>('any');
  const [homeAway, setHomeAway] = useState<'home' | 'away' | 'any'>('any');
  const [message, setMessage] = useState('');
  const [isBackAndForth, setIsBackAndForth] = useState(false);
  const [isLongTerm, setIsLongTerm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectingTeam, setIsSelectingTeam] = useState(false);
  const [selectingTeamPurpose, setSelectingTeamPurpose] = useState<'challenge' | 'post'>('post');
  const [targetRequestId, setTargetRequestId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ title: string; message: string } | null>(null);
  const [pendingMatch, setPendingMatch] = useState<{
    request: MatchmakerRequest;
    team: ChppTeamOption;
  } | null>(null);

  const effectiveManagerId = (isDev && impersonatedManagerId) || profile?.hattrick_user_id;

  const handleStartPosting = () => {
    if (!profile) {
      setShowLoginModal(true);
    } else {
      setIsPosting(true);
    }
  };

  const handleLogin = () => {
    document.cookie = `auth_return_url=${encodeURIComponent(window.location.pathname + window.location.search)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  };

  const myOwnHtTeamIds = useMemo(() => {
    const ids = new Set<number>();
    myTeams.forEach((t) => ids.add(t.teamId));
    return ids;
  }, [myTeams]);

  const filteredRequests = useMemo(() => {
    const isHfiView = activeTab === 'hfi';
    return requests.filter((r) => {
      // Keep browse wide open; only hide your own ads and explicitly hidden items.
      if (myOwnHtTeamIds.has(r.team?.ht_team_id || 0)) return false;
      if (locallyHiddenRequestIds.has(r.id)) return false;

      const teamGender = r.team?.gender_id ?? 1;
      const isFemale = teamGender === 0;
      return isHfiView ? isFemale : true;
    });
  }, [requests, activeTab, myOwnHtTeamIds, locallyHiddenRequestIds]);

  const myOpenRequest = useMemo(() => {
    const selectedTeam = myTeams.find((team) => team.teamId === selectedHtTeamId);
    if (!selectedTeam) return null;
    return myRequests.find((r) => r.team?.ht_team_id === selectedTeam.teamId && r.status === 'open') || null;
  }, [myRequests, myTeams, selectedHtTeamId]);

  const selectedChallengeRequest = useMemo(
    () => (targetRequestId ? requests.find((request) => request.id === targetRequestId) ?? null : null),
    [requests, targetRequestId],
  );

  const selectedTeamContext = useMemo(
    () => myTeams.find((team) => team.teamId === selectedHtTeamId),
    [myTeams, selectedHtTeamId],
  );

  const challengeTeams = useMemo(() => {
    if (selectingTeamPurpose !== 'challenge') return myTeams;
    const targetGenderId = selectedChallengeRequest?.gender_id;
    if (targetGenderId === undefined || targetGenderId === null) return myTeams;
    return myTeams.filter((team) => team.genderId === targetGenderId);
  }, [myTeams, selectingTeamPurpose, selectedChallengeRequest]);

  const postingTeamGroups = useMemo(() => groupTeamsByAvailability(myTeams), [myTeams]);

  const scoredRequests = useMemo(() => {
    return filteredRequests
      .map((request) => {
        const compatibility = myOpenRequest
          ? getCompatibilityScore(myOpenRequest, request)
          : getTeamFitScore(selectedTeamContext, request);
        const freshness = getFreshnessLabel(request, nowMs);
        const isNew = (nowMs - new Date(request.created_at).getTime()) / (1000 * 60 * 60) < 24;
        return {
          request,
          compatibility,
          freshness,
          isNew,
        };
      })
      .sort((a, b) => {
        if (b.compatibility.score !== a.compatibility.score) return b.compatibility.score - a.compatibility.score;
        return new Date(b.request.created_at).getTime() - new Date(a.request.created_at).getTime();
      });
  }, [filteredRequests, myOpenRequest, selectedTeamContext, nowMs]);

  useEffect(() => {
    if (!import.meta.env.DEV || myTeams.length === 0) return;
    console.table(
      myTeams.map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        genderId: team.genderId,
        availabilityStatus: team.availabilityStatus,
        availabilityReason: team.availabilityReason || '',
      })),
    );
  }, [myTeams]);

  useEffect(() => {
    if (!import.meta.env.DEV || !isSelectingTeam) return;
    console.table(
      challengeTeams.map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        genderId: team.genderId,
        availabilityStatus: team.availabilityStatus,
        availabilityReason: team.availabilityReason || '',
      })),
    );
  }, [challengeTeams, isSelectingTeam]);

  useEffect(() => {
    if (!import.meta.env.DEV || scoredRequests.length === 0) return;
    const current = scoredRequests[currentIndex];
    if (!current?.request?.team) return;

    console.table([
      {
        teamId: current.request.team.ht_team_id,
        teamName: current.request.team.name,
        genderId: current.request.team.gender_id,
        availabilityStatus: current.request.status,
        availabilityReason: current.freshness.label,
      },
    ]);
  }, [currentIndex, scoredRequests]);

  useEffect(() => {
    setTimeout(() => {
      setCurrentIndex((prev) => Math.min(prev, Math.max(0, scoredRequests.length - 1)));
    }, 0);
  }, [scoredRequests.length]);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const query = supabase
        .from('matchmaker_requests')
        .select(
          `
        *,
        team:teams!matchmaker_requests_team_id_fkey(
          name, ht_team_id, logo_url, country_name, league_id,
          gender_id, fanclub_size, arena_id, arena_size, arena_image_url
        ),
        profile:profiles!matchmaker_requests_manager_ht_id_fkey(manager_name, avatar_json, country_name, league_id),
        matched_team:teams!matchmaker_requests_matched_with_team_id_fkey(name, ht_team_id, logo_url, country_name)
        `,
        )
        .eq('status', 'open');

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      setRequests((data as unknown as MatchmakerRequest[]) || []);
    } catch (err) {
      console.error('Error fetching requests:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMyRequests = useCallback(async () => {
    const myHtId = profile?.hattrick_user_id ? Number(profile.hattrick_user_id) : null;
    if (!myHtId) return;

    try {
      const { data, error } = await supabase
        .from('matchmaker_requests')
        .select(
          `
        *,
        team:teams!matchmaker_requests_team_id_fkey(
          name, ht_team_id, logo_url, country_name, league_id, gender_id,
          fanclub_size, arena_id, arena_size, arena_image_url
        ),
        profile:profiles!matchmaker_requests_manager_ht_id_fkey(manager_name, avatar_json, country_name, league_id),
        matched_team:teams!matchmaker_requests_matched_with_team_id_fkey(name, ht_team_id, logo_url, country_name)
      `,
        )
        .eq('manager_ht_id', myHtId)
        .in('status', ['open', 'matched'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      const myAds = (data as unknown as MatchmakerRequest[]) || [];
      setMyRequests(myAds);

      // Also update local hidden list with any of my open ad IDs
      myAds.forEach((ad) => {
        if (ad.status === 'open') hideRequestIdLocally(ad.id);
      });
    } catch (err) {
      console.error('Error fetching my requests:', err);
    }
  }, [profile, hideRequestIdLocally]);

  const refreshMyTeams = useCallback(
    async (managerIdOverride?: string) => {
      const targetManagerId = managerIdOverride || profile?.hattrick_user_id;
      if (!targetManagerId) return;

      setTeamsLoading(true);
      setTeamsError(null);
      setTeamsWarning(null);

      try {
        const res = await fetch(`/api/matchmaker/teams?managerId=${targetManagerId}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Could not refresh your teams from Hattrick.');
        }

        const teams = normalizeTeamList((data.teams as ChppTeamOption[]) || []);
        setMyTeams(teams);

        if (import.meta.env.DEV) {
          console.table(
            teams.map((team) => ({
              teamId: team.teamId,
              teamName: team.teamName,
              genderId: team.genderId,
              availabilityStatus: team.availabilityStatus,
              availabilityReason: team.availabilityReason || '',
            })),
          );
        }

        setSelectedHtTeamId((current) => {
          if (current && teams.some((team) => team.teamId === current && team.availabilityStatus === 'available'))
            return current;
          const availableTeam = teams.find((team) => team.availabilityStatus === 'available');
          return availableTeam?.teamId || 0;
        });

        if (data.warning) {
          setTeamsWarning(data.warning);
        }
      } catch (error) {
        console.error('Error refreshing matchmaker teams:', error);
        setMyTeams([]);
        setSelectedHtTeamId(0);
        setTeamsError(
          error instanceof Error
            ? error.message
            : 'Could not refresh your Hattrick teams right now. Please try again shortly.',
        );
      } finally {
        setTeamsLoading(false);
      }
    },
    [profile],
  );

  useEffect(() => {
    if (profile?.hattrick_user_id) {
      void (async () => await refreshMyTeams())();
    }
  }, [profile, refreshMyTeams]);

  useEffect(() => {
    void (async () => await fetchRequests())();
  }, [fetchRequests]);

  useEffect(() => {
    void (async () => await fetchMyRequests())();
  }, [fetchMyRequests]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveManagerId || !selectedHtTeamId) return;

    setIsSaving(true);
    setPublishError(null);
    try {
      const selectedTeam = myTeams.find((t) => t.teamId === selectedHtTeamId);
      if (!selectedTeam) {
        throw new Error('Please refresh your Hattrick clubs and select a current team.');
      }

      const res = await fetch('/api/matchmaker/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          managerId: effectiveManagerId,
          adminManagerId: isDev && impersonatedManagerId ? impersonatedManagerId : undefined,
          teamId: selectedHtTeamId,
          matchType,
          opponentLocation: location,
          homeAway,
          message: message.trim() || null,
          isBackAndForth,
          isLongTerm,
        }),
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(result.error || 'Could not publish this request right now.');
      }

      if (result.request?.id) {
        hideRequestIdLocally(result.request.id);
      }

      // Priority 1: Successful publish flow
      await Promise.all([fetchMyRequests(), fetchRequests()]);
      setActiveTab('my-requests');
      setIsPosting(false);
      setMessage('');
      setShowSuccessOverlay(true);
    } catch (err) {
      console.error('Error creating request:', err);
      setPublishError(
        err instanceof Error ? err.message : 'Could not publish this request right now. Please try again later.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleAccept = async (requestId: string, teamId: number) => {
    const request = requests.find((item) => item.id === requestId);
    const team = myTeams.find((item) => item.teamId === teamId);

    if (!request || !team) {
      console.error('Could not prepare manual match flow:', { requestId, teamId });
      return;
    }

    setPendingMatch({ request, team });
    setIsSelectingTeam(false);
  };

  const selectedTeam = myTeams.find((team) => team.teamId === selectedHtTeamId);

  useEffect(() => {
    if (!import.meta.env.DEV || !selectedTeam) return;
    console.table([
      {
        teamId: selectedTeam.teamId,
        teamName: selectedTeam.teamName,
        genderId: selectedTeam.genderId,
        availabilityStatus: selectedTeam.availabilityStatus,
        availabilityReason: selectedTeam.availabilityReason || '',
      },
    ]);
  }, [selectedTeam]);

  const canPublish =
    !teamsLoading &&
    !!selectedTeam &&
    selectedTeam.availabilityStatus === 'available' &&
    !isSaving;

  return (
    <div className={styles.view}>
      {/* Browsing As Overlay */}
      {myTeams.length > 1 && profile && (
        <div className={styles.browsingAsOverlay}>
          <span>Selected team for challenge:</span>
          <select value={selectedHtTeamId} onChange={(e) => setSelectedHtTeamId(Number(e.target.value))}>
            {myTeams.map((team) => (
              <option key={team.teamId} value={team.teamId}>
                {team.teamName} {team.genderId === 0 ? '(HFI)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <header className={styles.headerContainer}>
        <div className={styles.tinderHeroCard}>
          <div className={styles.heroTopBar}>
            <span>Instant 120 min Friendly Matcher</span>
            <button className={styles.closeBtn} onClick={() => navigate('/')}>
              <X size={24} weight="bold" />
            </button>
          </div>

          <div className={styles.heroImageContainer}>
            <img src="/tinder-date-long-transp.png" alt="Tinder Date" className={styles.heroImage} />
            <div className={styles.heroBranding}>
              <h1>
                <span>HT-120min Tinder</span>
              </h1>
            </div>
          </div>

          <div className={styles.heroActions}>
            <p className={styles.heroSubtitle}>
              Find your next 120 min training partner. No awkard concept explanations — we all know what we're here for.
              Pick and challenge.
            </p>
            <Button size="lg" variant="tinder" onClick={handleStartPosting}>
              Post an Ad
            </Button>
          </div>
        </div>

        <div className={styles.tabs}>
          <button
            className={activeTab === 'browse' ? styles.active : ''}
            onClick={() => setActiveTab('browse')}
          >
            Find Match
          </button>
          <button className={activeTab === 'hfi' ? styles.active : ''} onClick={() => setActiveTab('hfi')}>
            Female Only Zone
          </button>
          <button
            className={activeTab === 'my-requests' ? styles.active : ''}
            onClick={() => setActiveTab('my-requests')}
          >
            My Ads
          </button>
        </div>
      </header>

      {activeTab === 'browse' || activeTab === 'hfi' ? (
        <div className={styles.browserContainer}>
          {loading ? (
            <div className={styles.loadingState}>
              <ArrowsOut size={48} className={styles.spin} />
              <p>Finding potential matches...</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className={styles.emptyState}>
              <Handshake size={64} opacity={0.2} />
              <p>
                {activeTab === 'hfi'
                  ? 'No female teams are looking for matches right now. Why not post your HFI ad?'
                  : 'No teams are looking for matches right now. Be the first to post an ad!'}
              </p>
              <Button variant="tinder" onClick={handleStartPosting}>
                Post an Ad
              </Button>
            </div>
          ) : (
            (() => {
              const entry = scoredRequests[currentIndex];
              const req = entry?.request;
              if (!req) return null;
              const compatibilityTitle = myOpenRequest
                ? [
                    `Compared with: ${req.team?.name || 'this team'}`,
                    'Reasons:',
                    ...(entry.compatibility.labels.length > 0
                      ? entry.compatibility.labels.map((label) => `✓ ${label}`)
                      : ['✓ Default match preferences']),
                  ].join('\n')
                : 'Match score based on venue, location, match type and partnership preferences.';

              return (
                <div className={styles.cardWrapper}>
                  <button
                    className={styles.navArrow}
                    style={{ left: '-120px' }}
                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                    disabled={currentIndex === 0}
                  >
                    <CaretLeft weight="bold" />
                  </button>
                  <div className={styles.tinderCard}>
                    <div className={styles.cardHeader}>
                      {req.team?.arena_image_url && (
                        <div
                          className={styles.arenaBackground}
                          style={{ backgroundImage: `url(${req.team.arena_image_url})` }}
                        />
                      )}
                      <div className={styles.teamInfo}>
                        <div className={styles.teamMain}>
                          {req.team?.logo_url ? (
                            <img src={req.team.logo_url} alt="" className={styles.teamLogo} />
                          ) : (
                            <Handshake size={48} className={styles.teamPlaceholder} />
                          )}
                          <div className={styles.teamText}>
                            <h2 className={styles.teamName}>
                              {req.team?.name} {req.team?.gender_id === 0 ? '(HFI)' : ''}
                            </h2>
                            <div className={styles.teamMeta}>
                              {req.team?.league_id && (
                                <img
                                  src={`https://www.hattrick.org/Img/flags/${req.team.league_id}.png`}
                                  alt=""
                                  className={styles.flag}
                                />
                              )}
                              <span>{req.team?.country_name}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className={styles.managerInfo}>
                        <span className={styles.managerName}>{req.profile?.manager_name}</span>
                        <div className={styles.managerAvatar}>
                          <Avatar avatar={req.profile?.avatar_json || null} variant="circle" size={48} />
                        </div>
                      </div>
                    </div>

                    <div className={styles.cardBody} style={{ paddingTop: '2.5rem' }}>
                      <div className={styles.adMetaRow}>
                        {myOpenRequest ? (
                          <span
                            className={styles.compatibilityBadge}
                            title={compatibilityTitle}
                          >
                            {entry.compatibility.score}% Match
                          </span>
                        ) : (
                          <span
                            className={styles.compatibilityHint}
                            title={compatibilityTitle}
                          >
                            {entry.compatibility.score}% Match
                          </span>
                        )}
                        <span
                          className={`${styles.availabilityBadge} ${styles[entry.freshness.tone]}`}
                          title="Based on how recently the ad was posted."
                        >
                          {entry.freshness.label}
                        </span>
                        {entry.isNew && <span className={styles.newBadge}>NEW</span>}
                      </div>

                      <div className={styles.matchSettings}>
                        <div className={styles.settingItem}>
                          <Trophy size={20} weight="fill" color="var(--tinder-bg)" />
                          <span>{req.match_type === '120min' ? '120 min Cup Rules' : '90 min OK'}</span>
                        </div>
                        <div className={styles.settingItem}>
                          <Clock size={20} weight="fill" color="var(--tinder-bg)" />
                          <span>
                            {req.home_away === 'home' && 'At my place'}
                            {req.home_away === 'away' && 'At your place'}
                            {req.home_away === 'any' && 'Home or Away'}
                          </span>
                        </div>
                        <div className={styles.settingItem}>
                          <ArrowsOut size={20} weight="fill" color="var(--tinder-bg)" />
                          <span>
                            {req.opponent_location === 'domestic' && 'Domestic only'}
                            {req.opponent_location === 'international_only' && 'Will travel'}
                            {req.opponent_location === 'any' && 'Anywhere'}
                          </span>
                        </div>
                      </div>

                      <div className={styles.adProfileSummary}>
                        <span className={styles.summaryLabel}>Looking for</span>
                        <div className={styles.badges}>
                          <span className={styles.badge}>
                            {req.match_type === '120min' ? '120 min training' : '90 min acceptable'}
                          </span>
                          <span className={styles.badge}>
                            {req.home_away === 'home'
                              ? 'My place'
                              : req.home_away === 'away'
                                ? 'Your place'
                                : 'Either venue'}
                          </span>
                          <span className={styles.badge}>
                            {req.opponent_location === 'domestic'
                              ? `Domestic (${req.team?.country_name || 'same country'})`
                              : req.opponent_location === 'international_only'
                                ? 'International only'
                                : 'Anywhere'}
                          </span>
                          <span className={styles.badge}>
                            {req.is_long_term ? 'Long-term partner' : 'One-off match'}
                          </span>
                          {req.is_back_and_forth && <span className={styles.badge}>Home/away exchange</span>}
                        </div>
                      </div>

                      {req.message && <div className={styles.message}>"{req.message}"</div>}
                    </div>

                    <div className={styles.cardActions}>
                      <button
                        className={styles.dislikeBtn}
                        onClick={() => setCurrentIndex((prev) => Math.min(filteredRequests.length - 1, prev + 1))}
                      >
                        <X size={32} weight="bold" />
                      </button>
                      <button
                        className={styles.likeBtn}
                        onClick={() => {
                          if (!profile) {
                            setShowLoginModal(true);
                          } else {
                            setIsSelectingTeam(true);
                            setSelectingTeamPurpose('challenge');
                            setTargetRequestId(req.id);
                          }
                        }}
                      >
                        <Heart size={32} weight="fill" />
                      </button>
                    </div>

                    {showSuccessOverlay && (
                      <div className={styles.successOverlay}>
                        <Heart size={80} weight="fill" color="#fff" />
                        <h2>Published!</h2>
                        {selectedTeam && (
                          <div style={{ marginBottom: '2rem' }}>
                            <p style={{ fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                              {selectedTeam.teamName} {selectedTeam.genderId === 0 ? '(HFI)' : ''}
                            </p>
                            <p>{matchType === '120min' ? '⚔️ 120 minute cup rules' : '⚽ 90 minute OK'}</p>
                            <p>
                              {location === 'domestic'
                                ? `🏠 my country only (${selectedTeam.countryName})`
                                : location === 'international_only'
                                  ? '🌍 will travel'
                                  : '🗺 Anywhere'}
                            </p>
                          </div>
                        )}
                        <Button variant="tinder" onClick={() => setShowSuccessOverlay(false)}>
                          Awesome!
                        </Button>
                      </div>
                    )}
                  </div>
                  <button
                    className={styles.navArrow}
                    style={{ right: '-120px' }}
                    onClick={() => setCurrentIndex((prev) => Math.min(scoredRequests.length - 1, prev + 1))}
                    disabled={currentIndex === scoredRequests.length - 1}
                  >
                    <CaretRight weight="bold" />
                  </button>
                </div>
              );
            })()
          )}
        </div>
      ) : (
        <div className={styles.myRequests}>
          <div className={styles.myAdsHeader}>
            <h3>Your teams</h3>
            <p>You will be notified when another manager books a match with your team.</p>
          </div>
          {myRequests.length > 0 ? (
            <div className={styles.requestGrid}>
              {myRequests.map((req) => (
                <div key={req.id} className={`${styles.myRequestCard} ${styles[req.status]}`} style={{ padding: 0 }}>
                  {req.status === 'open' && (
                    <div className={styles.cardEditOverlay}>
                      <Button
                        size="sm"
                        variant="tinder"
                        onClick={() => {
                          setSelectedHtTeamId(req.team?.ht_team_id || 0);
                          setIsPosting(true);
                        }}
                      >
                        Edit Ad
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        style={{ color: 'white', borderColor: 'white' }}
                        onClick={async () => {
                          if (confirm('Delete this friendly ad?')) {
                            const { error } = await supabase.from('matchmaker_requests').delete().eq('id', req.id);
                            if (!error) {
                              void fetchMyRequests();
                              void fetchRequests();
                            }
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}

                  <div
                    className={styles.tinderCard}
                    style={{ margin: 0, border: 'none', background: 'transparent', boxShadow: 'none' }}
                  >
                    <div className={styles.cardHeader}>
                      {req.team?.arena_image_url && (
                        <div
                          className={styles.arenaBackground}
                          style={{ backgroundImage: `url(${req.team.arena_image_url})` }}
                        />
                      )}
                      <div className={styles.teamInfo} style={{ width: '100%' }}>
                        <div className={styles.teamMain}>
                          {req.team?.logo_url ? (
                            <img src={req.team.logo_url} alt="" className={styles.teamLogo} />
                          ) : (
                            <Handshake size={48} className={styles.teamPlaceholder} />
                          )}
                          <div className={styles.teamText}>
                            <h2 className={styles.teamName} style={{ fontSize: '1.4rem' }}>
                              {req.team?.name} {req.team?.gender_id === 0 ? '(HFI)' : ''}
                            </h2>
                            <div className={styles.teamMeta}>
                              {req.team?.league_id && (
                                <img
                                  src={`https://www.hattrick.org/Img/flags/${req.team.league_id}.png`}
                                  alt=""
                                  className={styles.flag}
                                />
                              )}
                              <span>{req.team?.country_name}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <span
                        className={`${styles.statusBadge} ${styles[req.status]}`}
                        style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 5 }}
                      >
                        {req.status === 'open'
                          ? 'AVAILABLE'
                          : req.status === 'matched'
                            ? 'BOOKED'
                            : req.status.toUpperCase()}
                      </span>
                    </div>

                    <div className={styles.cardBody} style={{ padding: '1.5rem' }}>
                      <div className={styles.adMetaRow}>
                        <span
                          className={`${styles.availabilityBadge} ${req.status === 'open' ? styles.good : styles.bad}`}
                          title="Based on how recently the ad was posted."
                        >
                          {req.status === 'open' ? getFreshnessLabel(req, nowMs).label : 'Matched'}
                        </span>
                      </div>

                      <div className={styles.matchSettings}>
                        <div className={styles.settingItem}>
                          <Trophy size={18} weight="fill" color="var(--tinder-bg)" />
                          <span>{req.match_type === '120min' ? '120 min Cup Rules' : '90 min OK'}</span>
                        </div>
                        <div className={styles.settingItem}>
                          <Clock size={18} weight="fill" color="var(--tinder-bg)" />
                          <span>
                            {req.home_away === 'home' && 'At my place'}
                            {req.home_away === 'away' && 'At your place'}
                            {req.home_away === 'any' && 'Home or Away'}
                          </span>
                        </div>
                        <div className={styles.settingItem}>
                          <ArrowsOut size={18} weight="fill" color="var(--tinder-bg)" />
                          <span>
                            {req.opponent_location === 'domestic' && 'Domestic only'}
                            {req.opponent_location === 'international_only' && 'Will travel'}
                            {req.opponent_location === 'any' && 'Anywhere'}
                          </span>
                        </div>
                      </div>

                      <div className={styles.adProfileSummary}>
                        <span className={styles.summaryLabel}>Looking for</span>
                        <div className={styles.badges}>
                          <span className={styles.badge}>
                            {req.match_type === '120min' ? '120 min training' : '90 min acceptable'}
                          </span>
                          <span className={styles.badge}>
                            {req.home_away === 'home'
                              ? 'My place'
                              : req.home_away === 'away'
                                ? 'Your place'
                                : 'Either venue'}
                          </span>
                          <span className={styles.badge}>
                            {req.opponent_location === 'domestic'
                              ? `Domestic (${req.team?.country_name || 'same country'})`
                              : req.opponent_location === 'international_only'
                                ? 'International only'
                                : 'Anywhere'}
                          </span>
                          <span className={styles.badge}>
                            {req.is_long_term ? 'Long-term partner' : 'One-off match'}
                          </span>
                          {req.is_back_and_forth && <span className={styles.badge}>Home/away exchange</span>}
                        </div>
                      </div>

                      {req.message && (
                        <div className={styles.message} style={{ fontSize: '0.85rem', padding: '0.75rem' }}>
                          "{req.message}"
                        </div>
                      )}

                      {req.status === 'matched' && req.matched_with_team_id && (
                        <div className={styles.matchNotice} style={{ marginTop: '1rem' }}>
                          <Heart size={16} weight="fill" color="#ff4b2b" />
                          <span>
                            Matched with <strong>{req.matched_team?.name}</strong>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p>You haven't posted any teams this week.</p>
              <Button variant="primary" onClick={handleStartPosting}>
                Post Your First Team
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Posting Modal */}
      <Modal
        isOpen={isPosting}
        onClose={() => {
          setIsPosting(false);
          setPublishError(null);
        }}
        title={
          myRequests.some((r) => r.team?.ht_team_id === selectedHtTeamId && r.status === 'open')
            ? 'Edit Friendly Request'
            : 'Post a Friendly Request'
        }
      >
        <form onSubmit={handleCreateRequest} className={styles.postModal}>
          <div className={styles.formGroup}>
            <label>Team</label>
            {teamsLoading ? (
              <div className={styles.noTeamsMessage}>
                <p>Let's check on your teams first...</p>
              </div>
            ) : myTeams.length > 0 ? (
              <select
                value={selectedHtTeamId}
                onChange={(e) => setSelectedHtTeamId(Number(e.target.value))}
                className={styles.teamDropdown}
              >
                <option value={0}>Select a team</option>
                {postingTeamGroups.map((group) => (
                  <optgroup key={group.status} label={getAvailabilityGroupLabel(group.status)}>
                    {group.teams.map((team) => {
                      const selectable = team.availabilityStatus === 'available';
                      const labelParts = [team.teamName, team.genderId === 0 ? '(HFI)' : ''];
                      if (!selectable) {
                        labelParts.push(`- ${getAvailabilityStatusLabel(team)}`);
                      }
                      if (team.availabilityReason) {
                        labelParts.push(`(${team.availabilityReason})`);
                      }

                      return (
                        <option key={team.teamId} value={team.teamId} disabled={!selectable}>
                          {labelParts.filter(Boolean).join(' ')}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            ) : (
              <div className={styles.noTeamsMessage}>
                <Warning size={20} weight="bold" />
                <p>Hattrick doesn't seem to be telling us about your clubs. Please try again in a moment.</p>
                <Button variant="zero" onClick={() => refreshMyTeams()} disabled={teamsLoading}>
                  Retry
                </Button>
              </div>
            )}
            {selectedTeam && (
              <p className={styles.teamAvailabilityNote}>
                {getAvailabilityStatusLabel(selectedTeam)}
                {selectedTeam.availabilityReason ? ` · ${selectedTeam.availabilityReason}` : ''}
              </p>
            )}
            {teamsWarning && (
              <p className={styles.warningText}>
                <Info size={16} weight="bold" /> {teamsWarning}
              </p>
            )}
            {teamsError && (
              <p className={styles.warningText}>
                <Info size={16} weight="bold" /> {teamsError}
              </p>
            )}
            {publishError && (
              <p className={styles.warningText}>
                <Info size={16} weight="bold" /> {publishError}
              </p>
            )}
          </div>

          <div className={styles.formGroup}>
            <label>Match Type</label>
            <div className={styles.checkboxGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="radio"
                  name="matchType"
                  checked={matchType === '120min'}
                  onChange={() => setMatchType('120min')}
                />
                120 min Cup Rules
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="radio"
                  name="matchType"
                  checked={matchType === '90min_acceptable'}
                  onChange={() => setMatchType('90min_acceptable')}
                />
                90 min OK too
              </label>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>Opponent Location</label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value as 'domestic' | 'international_only' | 'any')}
            >
              <option value="any">Anywhere</option>
              <option value="domestic">my country only ({selectedTeam?.countryName})</option>
              <option value="international_only">will travel</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Venue Preference</label>
            <select value={homeAway} onChange={(e) => setHomeAway(e.target.value as 'home' | 'away' | 'any')}>
              <option value="any">your place or my place</option>
              <option value="away">your place</option>
              <option value="home">my place</option>
            </select>
          </div>

          <div className={styles.checkboxGroup}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={isBackAndForth} onChange={(e) => setIsBackAndForth(e.target.checked)} />
              <span>🔄 Ok for back-and-forth</span>
            </label>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={isLongTerm} onChange={(e) => setIsLongTerm(e.target.checked)} />
              <span>🗓 Looking for long term partner</span>
            </label>
          </div>

          <div className={styles.formGroup}>
            <label>Message (Optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Training young defenders..."
              rows={3}
            />
          </div>

          <div className={styles.postActions}>
            <Button type="submit" variant="primary" fullWidth disabled={!canPublish}>
              {isSaving
                ? 'Publishing...'
                : myRequests.some((r) => r.team?.ht_team_id === selectedHtTeamId && r.status === 'open')
                  ? 'Update Ad'
                  : 'Publish Request'}
            </Button>
          </div>
        </form>
      </Modal>

      {pendingMatch && (
        <Modal
          isOpen={!!pendingMatch}
          onClose={() => {
            setPendingMatch(null);
            setCurrentIndex((prev) => prev + 1);
          }}
          title="It's a Match!"
        >
          <div className={styles.matchModal}>
            <div className={styles.matchCelebration}>
              <Heart size={64} weight="fill" color="#ff4b2b" className={styles.heartPop} />
              <h2>Ready for Kickoff?</h2>
              <p>This is a manual arrangement flow. No booking has been sent yet.</p>
            </div>

            <div className={styles.matchInstructions}>
              <div className={styles.matchActionButtons}>
                <Button
                  variant="primary"
                  style={{ background: 'var(--tinder-bg)', borderColor: 'var(--borderDark)' }}
                  onClick={() =>
                    window.open(
                      `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${pendingMatch.request.team?.ht_team_id}`,
                      '_blank',
                    )
                  }
                >
                  Open Team on Hattrick
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPendingMatch(null);
                    setCurrentIndex((prev) => prev + 1);
                  }}
                >
                  Close
                </Button>
              </div>
              <div className={styles.matchTeams}>
                <div>
                  <span className={styles.matchTeamLabel}>Your team</span>
                  <strong>{pendingMatch.team.teamName}</strong>
                </div>
                <div>
                  <span className={styles.matchTeamLabel}>Their ad</span>
                  <strong>{pendingMatch.request.team?.name}</strong>
                </div>
                <div>
                  <span className={styles.matchTeamLabel}>HT Team ID</span>
                  <strong>{pendingMatch.request.team?.ht_team_id}</strong>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      <TeamSelectorModal
        isOpen={isSelectingTeam}
        onClose={() => setIsSelectingTeam(false)}
        teams={challengeTeams}
        title={selectingTeamPurpose === 'post' ? 'Which team is posting?' : 'Select Challenging Team'}
        onSelect={(teamId) => {
          if (selectingTeamPurpose === 'challenge') {
            void handleAccept(targetRequestId!, teamId);
          } else {
            setSelectedHtTeamId(teamId);
            setIsSelectingTeam(false);
            setIsPosting(true);
          }
        }}
      />
      <Modal isOpen={!!notification} onClose={() => setNotification(null)} title={notification?.title}>
        <p>{notification?.message}</p>
        <Button variant="primary" onClick={() => setNotification(null)} style={{ marginTop: '1rem' }}>
          OK
        </Button>
      </Modal>
      <Modal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} title="Sign in required">
        <p style={{ marginBottom: '1rem' }}>To book or publish friendlies you need a connected Hattrick account.</p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Button variant="primary" onClick={handleLogin}>
            Login with Hattrick
          </Button>
          <Button variant="outline" onClick={() => setShowLoginModal(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </div>
  );
};
