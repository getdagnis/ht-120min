import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import type { MatchmakerRequest, MatchmakerTeamOption } from '../../utils/matchmaker';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { TeamSelectorModal } from '../../components/TeamSelectorModal/TeamSelectorModal';
import { getDisplayTeamName } from '../../utils/matchmaker';
import { getLeagueNameById } from '../../utils/leagues';
import { getMockMatchmakerRequests, getMockMatchmakerTeams, isMatchmakerMockDataEnabled } from '../../mock/matchmaker';
import {
  Handshake,
  X,
  Heart,
  Clock,
  Info,
  Warning,
  ArrowsOut,
  Trophy,
  CaretLeft,
  CaretRight,
  PencilSimple,
  Trash,
} from 'phosphor-react';
import styles from './Matchmaker.module.sass';

type ChppTeamOption = MatchmakerTeamOption;

const normalizeTeamList = (teams: MatchmakerTeamOption[]) =>
  teams.map((team) => ({
    ...team,
    availabilityStatus: team.availabilityStatus ?? 'unknown',
  }));

type JoinedTeamRow = NonNullable<MatchmakerRequest['team']> & {
  availability_status?: MatchmakerTeamOption['availabilityStatus'] | null;
  availability_reason?: string | null;
};

type JoinedRequestRow = Omit<MatchmakerRequest, 'team' | 'matched_team' | 'profile'> & {
  team?: JoinedTeamRow | null;
  matched_team?: MatchmakerRequest['matched_team'] | null;
  profile?: MatchmakerRequest['profile'] | null;
};

const normalizeJoinedTeam = (team?: JoinedTeamRow | null): MatchmakerRequest['team'] | undefined => {
  if (!team) return undefined;

  const { availability_status, availability_reason, ...rest } = team;

  return {
    ...rest,
    // keep the normalized availability status for UI logic
    availabilityStatus: team.availabilityStatus ?? availability_status ?? 'unknown',
    // preserve the raw DB/CHPP value so we can detect explicit nulls (CHPP returned no value)
    availabilityStatusRaw: availability_status === undefined ? undefined : availability_status,
    availabilityReason: team.availabilityReason ?? availability_reason ?? undefined,
  };
};

const normalizeMatchmakerRequest = (request: JoinedRequestRow): MatchmakerRequest => ({
  ...request,
  team: normalizeJoinedTeam(request.team),
  matched_team: request.matched_team || undefined,
  profile: request.profile || undefined,
});

const getAvailabilityStatusLabel = (team: MatchmakerTeamOption) => {
  if (team.availabilityStatus === 'available') return 'Available now';
  if (team.availabilityStatus === 'booked') return 'Booked';
  if (team.availabilityStatus === 'unknown') return 'Unknown';
  return 'Unavailable';
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
    label: 'Posted recently',
    tone: 'bad' as const,
  };
};

const isVenueComplementary = (a: MatchmakerRequest['home_away'], b: MatchmakerRequest['home_away']) =>
  (a === 'home' && b === 'away') || (a === 'away' && b === 'home') || a === 'any' || b === 'any';

const isLocationCompatible = (a: MatchmakerRequest, b: MatchmakerRequest) => {
  const aCountry = a.team?.country_id ?? a.team?.league_id ?? null;
  const bCountry = b.team?.country_id ?? b.team?.league_id ?? null;
  const sameCountry = aCountry !== null && aCountry === bCountry;
  const differentCountry = aCountry !== null && bCountry !== null && !sameCountry;

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

type BrowseTabKey = 'browse' | 'hfi' | 'long-term';
type MatchmakerTabKey = BrowseTabKey | 'my-requests';

const HFI_LEAGUE_ID = 3000;

const resolveRequestGender = (request: MatchmakerRequest): number => request.gender_id ?? request.team?.gender_id ?? 1;

const isFemaleRequest = (request: MatchmakerRequest) =>
  resolveRequestGender(request) === 0 || request.team?.league_id === HFI_LEAGUE_ID;

const isBookedRequest = (request: MatchmakerRequest) => request.team?.availabilityStatus === 'booked';

const getBrowseCardActions = (tab: BrowseTabKey, request: MatchmakerRequest) => {
  if (tab === 'browse') {
    return { showChallengeNow: true, showShowInterest: false };
  }

  if (tab === 'long-term') {
    return { showChallengeNow: false, showShowInterest: true };
  }

  // Female Only: immediate challengers vs booked long-term seekers
  if (isBookedRequest(request)) {
    return { showChallengeNow: false, showShowInterest: true };
  }

  return { showChallengeNow: true, showShowInterest: false };
};

const isHiddenOwnAd = (
  request: MatchmakerRequest,
  options: {
    mockDataEnabled: boolean;
    myOwnHtTeamIds: Set<number>;
    locallyHiddenRequestIds: Set<string>;
  },
) => {
  if (options.mockDataEnabled) return false;
  if (options.myOwnHtTeamIds.has(request.team?.ht_team_id || 0)) return true;
  if (options.locallyHiddenRequestIds.has(request.id)) return true;
  return false;
};

const requestMatchesBrowseTab = (request: MatchmakerRequest, tab: BrowseTabKey): boolean => {
  const avail = request.team?.availabilityStatus;
  const isFemale = isFemaleRequest(request);

  if (tab === 'hfi') {
    if (!isFemale) return false;
    // Immediate + long-term female ads in one pool (incl. booked long-term seekers)
    return avail === 'available' || !!request.is_long_term;
  }

  if (tab === 'long-term') {
    if (isFemale) return false;
    return !!request.is_long_term || avail === 'booked';
  }

  if (isFemale) return false;
  return avail === 'available';
};

const pickDefaultTab = (counts: Record<MatchmakerTabKey, number>, hasMyRequestsTab: boolean): MatchmakerTabKey => {
  if (hasMyRequestsTab && counts['my-requests'] > 0) {
    return 'my-requests';
  }

  const browseOrder: BrowseTabKey[] = ['browse', 'hfi', 'long-term'];
  return browseOrder.find((tab) => counts[tab] > 0) ?? 'browse';
};

const formatTabLabel = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label);

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

  if ((selectedTeam.countryId ?? selectedTeam.leagueId) && (target.team?.country_id ?? target.team?.league_id)) {
    const sameCountry =
      (selectedTeam.countryId ?? selectedTeam.leagueId) === (target.team?.country_id ?? target.team?.league_id);
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
    labels.push('Category compatible');
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
  const mockDataEnabled = isMatchmakerMockDataEnabled();
  const mockTeams = useMemo(() => (mockDataEnabled ? getMockMatchmakerTeams() : []), [mockDataEnabled]);
  const mockRequests = useMemo(
    () => (mockDataEnabled ? getMockMatchmakerRequests(new Date(nowMs)) : []),
    [mockDataEnabled, nowMs],
  );
  const mockStats = useMemo(() => {
    const availableTeams = mockTeams.filter((team) => team.availabilityStatus === 'available').length;
    const bookedTeams = mockTeams.filter((team) => team.availabilityStatus === 'booked').length;
    const femaleTeams = mockTeams.filter((team) => team.genderId === 0).length;
    const internationalListings = mockRequests.filter((request) => request.team?.league_id !== 53).length;

    return {
      availableTeams,
      bookedTeams,
      femaleTeams,
      internationalListings,
      totalTeams: mockTeams.length,
      totalRequests: mockRequests.length,
    };
  }, [mockTeams, mockRequests]);
  const [activeTab, setActiveTab] = useState<'browse' | 'my-requests' | 'hfi' | 'long-term'>('browse');
  const [requests, setRequests] = useState<MatchmakerRequest[]>([]);
  const isDev = import.meta.env.VITE_MATCHMAKER_DEV_MODE === 'true' || window.location.hostname === 'localhost';
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [myRequests, setMyRequests] = useState<MatchmakerRequest[]>([]);
  const [hasSetInitialTab, setHasSetInitialTab] = useState(false);
  const hasMyRequests = myRequests.length > 0;
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
  const [teamsLoading, setTeamsLoading] = useState(mockDataEnabled);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsWarning, setTeamsWarning] = useState<string | null>(null);
  const [selectedHtTeamId, setSelectedHtTeamId] = useState<number>(0);
  const [matchType, setMatchType] = useState<'120min' | '90min_acceptable'>('120min');
  const [location, setLocation] = useState<'domestic' | 'international_only' | 'any'>('any');
  const [homeAway, setHomeAway] = useState<'home' | 'away' | 'any'>('any');
  const [message, setMessage] = useState('');
  const [isBackAndForth, setIsBackAndForth] = useState(false);
  const [isLongTerm, setIsLongTerm] = useState(false);
  const [isLongTermLocked, setIsLongTermLocked] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectingTeam, setIsSelectingTeam] = useState(false);
  const [selectingTeamPurpose, setSelectingTeamPurpose] = useState<'challenge' | 'post'>('post');
  const [targetRequestId, setTargetRequestId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ title: string; message: string } | null>(null);
  const [mockBrowseScope, setMockBrowseScope] = useState<'available' | 'booked' | 'all'>('available');
  const [pendingMatch, setPendingMatch] = useState<{
    request: MatchmakerRequest;
    team: ChppTeamOption;
  } | null>(null);

  const effectiveManagerId = (isDev && impersonatedManagerId) || profile?.hattrick_user_id;

  const handleStartPosting = () => {
    if (mockDataEnabled) {
      setIsPosting(true);
      return;
    }

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

  const displayRequests = useMemo(() => requests, [requests]);

  const ownAdFilterOptions = useMemo(
    () => ({
      mockDataEnabled,
      myOwnHtTeamIds,
      locallyHiddenRequestIds,
    }),
    [mockDataEnabled, myOwnHtTeamIds, locallyHiddenRequestIds],
  );

  const tabAdCounts = useMemo(() => {
    const visibleRequests = displayRequests.filter((request) => !isHiddenOwnAd(request, ownAdFilterOptions));
    return {
      browse: visibleRequests.filter((request) => requestMatchesBrowseTab(request, 'browse')).length,
      hfi: visibleRequests.filter((request) => requestMatchesBrowseTab(request, 'hfi')).length,
      'long-term': visibleRequests.filter((request) => requestMatchesBrowseTab(request, 'long-term')).length,
      'my-requests': myRequests.length,
    };
  }, [displayRequests, myRequests.length, ownAdFilterOptions]);

  const tabItems: Array<{ key: MatchmakerTabKey; label: string }> = [
    { key: 'browse', label: formatTabLabel('Hook Up Now', tabAdCounts.browse) },
    { key: 'hfi', label: formatTabLabel('Female Only', tabAdCounts.hfi) },
    { key: 'long-term', label: formatTabLabel('Long-Term', tabAdCounts['long-term']) },
    ...(hasMyRequests
      ? [{ key: 'my-requests' as const, label: formatTabLabel('My Ads', tabAdCounts['my-requests']) }]
      : []),
  ];

  const filteredRequests = useMemo(() => {
    if (activeTab === 'my-requests') return [];

    return displayRequests.filter((request) => {
      if (isHiddenOwnAd(request, ownAdFilterOptions)) return false;
      return requestMatchesBrowseTab(request, activeTab);
    });
  }, [displayRequests, activeTab, ownAdFilterOptions]);

  const myOpenRequest = useMemo(() => {
    const selectedTeam = myTeams.find((team) => team.teamId === selectedHtTeamId);
    if (!selectedTeam) return null;
    return myRequests.find((r) => r.team?.ht_team_id === selectedTeam.teamId && r.status === 'open') || null;
  }, [myRequests, myTeams, selectedHtTeamId]);

  const selectedChallengeRequest = useMemo(
    () => (targetRequestId ? (displayRequests.find((request) => request.id === targetRequestId) ?? null) : null),
    [displayRequests, targetRequestId],
  );

  const selectedTeamContext = useMemo(
    () => myTeams.find((team) => team.teamId === selectedHtTeamId),
    [myTeams, selectedHtTeamId],
  );

  const handleSelectTeamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(e.target.value);
    setSelectedHtTeamId(id);
    const team = myTeams.find((t) => t.teamId === id);
    if (team) {
      const isAvail = (team.availabilityStatus ?? 'unknown') === 'available';
      if (!isAvail) {
        setIsLongTerm(true);
        setIsLongTermLocked(true);
      } else {
        setIsLongTerm(false);
        setIsLongTermLocked(false);
      }
    } else {
      setIsLongTermLocked(false);
    }
  };

  const getDisplayCountryName = (requestTeam?: MatchmakerRequest['team'] | null) => {
    if (!requestTeam) return undefined;
    return getLeagueNameById(requestTeam.country_id ?? requestTeam.league_id) || requestTeam.country_name || undefined;
  };

  const challengeTeams = useMemo(() => {
    if (selectingTeamPurpose !== 'challenge') return myTeams;
    const targetGenderId = selectedChallengeRequest?.gender_id;
    if (targetGenderId === undefined || targetGenderId === null) return myTeams;
    return myTeams.filter((team) => team.genderId === targetGenderId);
  }, [myTeams, selectingTeamPurpose, selectedChallengeRequest]);

  const postingTeamGroupsForModal = useMemo(() => {
    const openRequestTeamIds = new Set(
      myRequests
        .filter((request) => request.status === 'open' && request.team?.ht_team_id)
        .map((request) => request.team!.ht_team_id),
    );

    const available = myTeams
      .filter((t) => (t.availabilityStatus ?? 'unknown') === 'available')
      .sort((a, b) => a.teamName.localeCompare(b.teamName));

    const longTermWithoutAd = myTeams
      .filter((t) => (t.availabilityStatus ?? 'unknown') !== 'available' && !openRequestTeamIds.has(t.teamId))
      .sort((a, b) => a.teamName.localeCompare(b.teamName));

    const existingAds = myTeams
      .filter((t) => (t.availabilityStatus ?? 'unknown') !== 'available' && openRequestTeamIds.has(t.teamId))
      .sort((a, b) => a.teamName.localeCompare(b.teamName));

    const groups: { status: 'available' | 'long-term-only' | 'existing-ad-update'; teams: ChppTeamOption[] }[] = [];
    if (available.length) groups.push({ status: 'available', teams: available });
    if (longTermWithoutAd.length) groups.push({ status: 'long-term-only', teams: longTermWithoutAd });
    if (existingAds.length) groups.push({ status: 'existing-ad-update', teams: existingAds });
    return groups;
  }, [myTeams, myRequests]);

  const scoredRequests = useMemo(() => {
    const byCreatedAtDesc = (a: MatchmakerRequest, b: MatchmakerRequest) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

    if (mockDataEnabled) {
      const available = filteredRequests
        .filter((request) => request.team?.availabilityStatus === 'available')
        .sort(byCreatedAtDesc);
      const booked = filteredRequests
        .filter((request) => request.team?.availabilityStatus === 'booked')
        .sort(byCreatedAtDesc);
      const unavailable = filteredRequests
        .filter((request) => request.team?.availabilityStatus === 'unavailable')
        .sort(byCreatedAtDesc);
      const unknown = filteredRequests
        .filter((request) => request.team?.availabilityStatus === 'unknown')
        .sort(byCreatedAtDesc);

      const visibleRequests =
        mockBrowseScope === 'available'
          ? available
          : mockBrowseScope === 'booked'
            ? booked
            : [...available, ...booked, ...unavailable, ...unknown];

      return visibleRequests.map((request) => ({
        request,
        compatibility: { score: 0, labels: [] as string[] },
        freshness: getFreshnessLabel(request, nowMs),
      }));
    }

    return filteredRequests
      .map((request) => {
        const compatibility = myOpenRequest
          ? getCompatibilityScore(myOpenRequest, request)
          : getTeamFitScore(selectedTeamContext, request);
        const freshness = getFreshnessLabel(request, nowMs);
        return {
          request,
          compatibility,
          freshness,
        };
      })
      .sort((a, b) => {
        if (b.compatibility.score !== a.compatibility.score) return b.compatibility.score - a.compatibility.score;
        return new Date(b.request.created_at).getTime() - new Date(a.request.created_at).getTime();
      });
  }, [filteredRequests, mockDataEnabled, mockBrowseScope, myOpenRequest, selectedTeamContext, nowMs]);

  const mockBrowseEndReached = mockDataEnabled && currentIndex >= scoredRequests.length;

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
  }, [mockDataEnabled, myTeams]);

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
  }, [mockDataEnabled, challengeTeams, isSelectingTeam]);

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
  }, [mockDataEnabled, currentIndex, scoredRequests]);

  useEffect(() => {
    setTimeout(() => {
      setCurrentIndex((prev) => Math.min(prev, Math.max(0, scoredRequests.length - 1)));
    }, 0);
  }, [scoredRequests.length]);

  const fetchRequests = useCallback(
    async (options?: { silent?: boolean }) => {
      if (mockDataEnabled) {
        setRequests(mockRequests);
        return;
      }

      if (!options?.silent) {
        setLoading(true);
      }
      try {
        const query = supabase
          .from('matchmaker_requests')
          .select(
            `
        *,
        team:teams!matchmaker_requests_team_id_fkey(
          name, ht_team_id, logo_url, country_name, country_id, league_id,
          gender_id, fanclub_size, arena_id, arena_size, arena_image_url, availability_status, availability_reason
        ),
        profile:profiles!matchmaker_requests_manager_ht_id_fkey(manager_name, avatar_json, country_name, country_id, league_id),
        matched_team:teams!matchmaker_requests_matched_with_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id)
        `,
          )
          .eq('status', 'open');

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;

        setRequests(((data ?? []) as JoinedRequestRow[]).map((request) => normalizeMatchmakerRequest(request)));
      } catch (err) {
        console.error('Error fetching requests:', err);
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [mockDataEnabled, mockRequests],
  );

  const fetchMyRequests = useCallback(async () => {
    if (mockDataEnabled) {
      setMyRequests(mockRequests.slice(0, 4));
      return;
    }

    const myHtId = profile?.hattrick_user_id ? Number(profile.hattrick_user_id) : null;
    if (!myHtId) return;

    try {
      const { data, error } = await supabase
        .from('matchmaker_requests')
        .select(
          `
        *,
        team:teams!matchmaker_requests_team_id_fkey(
          name, ht_team_id, logo_url, country_name, country_id, league_id, gender_id,
          fanclub_size, arena_id, arena_size, arena_image_url, availability_status, availability_reason
        ),
        profile:profiles!matchmaker_requests_manager_ht_id_fkey(manager_name, avatar_json, country_name, country_id, league_id),
        matched_team:teams!matchmaker_requests_matched_with_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id)
      `,
        )
        .eq('manager_ht_id', myHtId)
        .in('status', ['open', 'matched'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      const myAds = ((data ?? []) as JoinedRequestRow[]).map((request) => normalizeMatchmakerRequest(request));
      setMyRequests(myAds);

      // Also update local hidden list with any of my open ad IDs
      myAds.forEach((ad) => {
        if (ad.status === 'open') hideRequestIdLocally(ad.id);
      });
    } catch (err) {
      console.error('Error fetching my requests:', err);
    }
  }, [profile, hideRequestIdLocally, mockDataEnabled, mockRequests]);

  useEffect(() => {
    if (hasSetInitialTab || loading) return;
    const nextTab = pickDefaultTab(tabAdCounts, hasMyRequests);

    setTimeout(() => {
      setActiveTab(nextTab);
      setHasSetInitialTab(true);
    }, 0);
  }, [hasSetInitialTab, loading, tabAdCounts, hasMyRequests]);

  useEffect(() => {
    if (!hasMyRequests && activeTab === 'my-requests') {
      setTimeout(() => {
        setActiveTab('browse');
      }, 0);
    }
  }, [activeTab, hasMyRequests]);

  const refreshMyTeams = useCallback(
    async (managerIdOverride?: string) => {
      if (mockDataEnabled) {
        const nextTeams = normalizeTeamList(mockTeams);
        setMyTeams(nextTeams);
        setSelectedHtTeamId((current) => {
          if (current && nextTeams.some((team) => team.teamId === current && team.availabilityStatus === 'available')) {
            return current;
          }
          const availableTeam = nextTeams.find((team) => team.availabilityStatus === 'available');
          return availableTeam?.teamId || 0;
        });
        setTeamsLoading(false);
        setTeamsError(null);
        setTeamsWarning(null);
        return;
      }

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
        const combinedTeams = [...teams, ...mockTeams];
        const uniqueTeams = Array.from(new Map(combinedTeams.map((team) => [team.teamId, team])).values());
        setMyTeams(uniqueTeams);

        if (import.meta.env.DEV) {
          console.table(
            uniqueTeams.map((team) => ({
              teamId: team.teamId,
              teamName: team.teamName,
              genderId: team.genderId,
              availabilityStatus: team.availabilityStatus,
              availabilityReason: team.availabilityReason || '',
            })),
          );
        }

        setSelectedHtTeamId((current) => {
          if (current && uniqueTeams.some((team) => team.teamId === current && team.availabilityStatus === 'available'))
            return current;
          const availableTeam = uniqueTeams.find((team) => team.availabilityStatus === 'available');
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
    [profile, mockTeams, mockDataEnabled],
  );

  useEffect(() => {
    if (mockDataEnabled) return;

    let cancelled = false;

    void (async () => {
      setLoading(true);

      try {
        if (profile?.hattrick_user_id) {
          await refreshMyTeams();
        }

        if (cancelled) return;

        await fetchRequests({ silent: true });
        if (cancelled) return;

        await fetchMyRequests();
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mockDataEnabled, profile?.hattrick_user_id, refreshMyTeams, fetchRequests, fetchMyRequests]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHtTeamId || (!mockDataEnabled && !effectiveManagerId)) return;

    setIsSaving(true);
    setPublishError(null);
    try {
      const selectedTeam = myTeams.find((t) => t.teamId === selectedHtTeamId);
      if (!selectedTeam) {
        throw new Error('Please refresh your Hattrick clubs and select a current team.');
      }

      if (mockDataEnabled) {
        const now = new Date();
        const requestId = `mock-publish-${now.getTime()}`;
        const publishedRequest: MatchmakerRequest = {
          id: requestId,
          team_id: `mock-team-${selectedTeam.teamId}`,
          manager_ht_id: selectedTeam.teamId,
          match_type: matchType,
          opponent_location: location,
          home_away: homeAway,
          match_day: 'Wednesday',
          time_window: null,
          message: message.trim() || null,
          status: 'open',
          matched_with_team_id: null,
          matched_at: null,
          expires_at: now.toISOString(),
          created_at: now.toISOString(),
          is_back_and_forth: isBackAndForth,
          is_long_term: isLongTerm,
          gender_id: selectedTeam.genderId ?? 1,
          is_mock: true,
          team: {
            name: selectedTeam.teamName,
            ht_team_id: selectedTeam.teamId,
            logo_url: selectedTeam.logo_url ?? null,
            country_name: selectedTeam.countryName ?? null,
            country_id: selectedTeam.leagueId ?? null,
            league_id: selectedTeam.leagueId ?? null,
            gender_id: selectedTeam.genderId ?? 1,
            fanclub_size: null,
            arena_id: null,
            arena_size: null,
            arena_image_url: null,
            availabilityStatus: selectedTeam.availabilityStatus,
            availabilityReason: selectedTeam.availabilityReason,
          },
          profile: {
            manager_name: 'Mock Manager',
            avatar_json: null,
            country_name: selectedTeam.countryName ?? null,
            country_id: selectedTeam.leagueId ?? null,
            league_id: selectedTeam.leagueId ?? null,
          },
        };

        setRequests((prev) => [publishedRequest, ...prev]);
        setMyRequests((prev) => [publishedRequest, ...prev]);
        setActiveTab('my-requests');
        setIsPosting(false);
        setMessage('');
        setShowSuccessOverlay(true);
        setIsSaving(false);
        return;
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

  useEffect(() => {
    if (!mockDataEnabled) return;

    const timer = window.setTimeout(() => {
      setRequests(mockRequests);
      setMyRequests(mockRequests.slice(0, 4));
      setMyTeams(mockTeams);
      setSelectedHtTeamId(
        mockTeams.find((team) => team.availabilityStatus === 'available')?.teamId || mockTeams[0]?.teamId || 0,
      );
      setCurrentIndex(0);
      setMockBrowseScope('available');
      setTeamsLoading(false);
      setLoading(false);
      console.table(
        mockTeams.map((team) => ({
          teamId: team.teamId,
          teamName: team.teamName,
          genderId: team.genderId,
          availabilityStatus: team.availabilityStatus,
          availabilityReason: team.availabilityReason || '',
        })),
      );
      console.table([
        {
          availableTeams: mockStats.availableTeams,
          bookedTeams: mockStats.bookedTeams,
          femaleTeams: mockStats.femaleTeams,
          internationalListings: mockStats.internationalListings,
          totalTeams: mockStats.totalTeams,
          totalRequests: mockStats.totalRequests,
        },
      ]);
    }, 1700);

    return () => window.clearTimeout(timer);
  }, [mockDataEnabled, mockRequests, mockTeams, mockStats]);

  const canPublish =
    !teamsLoading && !!selectedTeam && (selectedTeam.availabilityStatus === 'available' || isLongTerm) && !isSaving;

  const mockBrowseEndMessage =
    mockBrowseScope === 'available'
      ? "You've seen all currently available teams."
      : mockBrowseScope === 'booked'
        ? "You've seen all booked teams."
        : "You've seen all listings.";

  return (
    <div className={styles.view}>
      {mockDataEnabled && (
        <div className={styles.mockBanner}>
          <div className={styles.mockBannerCopy}>
            <span className={styles.mockBannerKicker}>TEST ENVIRONMENT</span>
            <strong>Using mock teams and mock friendlies.</strong>
            <span>Local demo mode is isolated from production data.</span>
          </div>
          <div className={styles.mockStats}>
            <span>{mockStats.availableTeams} Available Teams</span>
            <span>{mockStats.bookedTeams} Booked Teams</span>
            <span>{mockStats.femaleTeams} Female Teams</span>
            <span>{mockStats.internationalListings} International Listings</span>
          </div>
        </div>
      )}
      {/* Browsing As Overlay */}
      {myTeams.length > 1 && (profile || mockDataEnabled) && (
        <div className={styles.browsingAsOverlay}>
          <span>Selected team for challenge:</span>
          <select value={selectedHtTeamId} onChange={(e) => setSelectedHtTeamId(Number(e.target.value))}>
            {myTeams.map((team) => (
              <option key={team.teamId} value={team.teamId}>
                {getDisplayTeamName(team.teamName, team.genderId)}
                {team.is_mock ? ' (Mock)' : ''}
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
              <X size={24} />
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
          {tabItems.map((tab) => (
            <button
              key={tab.key}
              className={activeTab === tab.key ? styles.active : ''}
              onClick={() => {
                setActiveTab(tab.key);
                setCurrentIndex(0);
                setHasSetInitialTab(true);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {activeTab === 'browse' || activeTab === 'hfi' || activeTab === 'long-term' ? (
        <div className={styles.browserContainer}>
          {loading ? (
            <div className={styles.loadingState}>
              <ArrowsOut size={48} className={styles.spin} />
              <p>
                {mockDataEnabled
                  ? 'Synchronising friendly availability...'
                  : 'Checking team availability and loading listings...'}
              </p>
            </div>
          ) : mockBrowseEndReached ? (
            <div className={styles.emptyState}>
              <Handshake size={64} opacity={0.2} />
              <p>{mockBrowseEndMessage}</p>
              <div className={styles.endActions}>
                <Button
                  variant="tinder"
                  onClick={() => {
                    setMockBrowseScope('available');
                    setCurrentIndex(0);
                  }}
                >
                  Start Again
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMockBrowseScope('booked');
                    setCurrentIndex(0);
                  }}
                >
                  Show Booked Teams
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMockBrowseScope('all');
                    setCurrentIndex(0);
                  }}
                >
                  Show All Listings
                </Button>
              </div>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className={styles.emptyState}>
              <Handshake size={64} opacity={0.2} />
              <p>
                {activeTab === 'hfi'
                  ? 'No female teams are looking for matches right now. Why not post your HFI ad?'
                  : activeTab === 'browse'
                    ? 'No teams are available for friendlies this week. Post you own an ad!'
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

              return (
                <div className={`${styles.cardWrapper} ${styles.browseWrapper}`}>
                  <button
                    className={styles.navArrow}
                    style={{ left: '-120px' }}
                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                    disabled={currentIndex === 0}
                  >
                    <CaretLeft />
                  </button>
                  <div className={styles.myRequestCard}>
                    <div className={styles.tinderCard}>
                      <div className={styles.cardTop}>
                        <div className={styles.cardArena}>
                          {req.team?.arena_image_url && (
                            <div className={styles.arenaFrame}>
                              <img src={req.team.arena_image_url} alt="Arena" />
                            </div>
                          )}
                        </div>
                        <div className={styles.cardRight}>
                          <div className={styles.teamInfo}>
                            <div className={styles.teamMain}>
                              {req.team?.logo_url ? (
                                <img src={req.team.logo_url} alt="" className={styles.teamLogo} />
                              ) : (
                                <Handshake size={48} className={styles.teamPlaceholder} />
                              )}
                              <div className={styles.teamText}>
                                <h2 className={styles.teamName}>
                                  {getDisplayTeamName(req.team?.name || '', req.team?.gender_id)}
                                </h2>
                                <div className={styles.teamMeta}>
                                  {req.team?.league_id && (
                                    <img
                                      src={`https://www.hattrick.org/Img/flags/${req.team.league_id}.png`}
                                      alt=""
                                      className={styles.flag}
                                    />
                                  )}
                                  <span>{getDisplayCountryName(req.team)}</span>
                                </div>
                              </div>
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
                                  ? `Domestic (${getDisplayCountryName(req.team) || 'same country'})`
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
                          <div className={styles.adMetaRow}>
                            <span
                              className={`${styles.availabilityBadge} ${styles[entry.freshness.tone]}`}
                              title="Based on how recently the ad was posted."
                            >
                              {entry.freshness.label}
                            </span>
                            <span
                              className={`${styles.stateBadge} ${styles[req.team?.availabilityStatus || 'unknown']}`}
                              title={req.team?.availabilityReason || 'Availability from CHPP team details.'}
                            >
                              {req.team?.availabilityStatus === null
                                ? '404'
                                : req.team?.availabilityStatus === 'available'
                                  ? 'Available'
                                  : req.team?.availabilityStatus === 'booked'
                                    ? 'Booked This Week'
                                    : req.team?.availabilityStatus === 'unavailable'
                                      ? 'Unavailable'
                                      : 'Unknown'}
                            </span>
                            {req.is_mock && <span className={styles.mockBadge}>Mock</span>}
                          </div>
                        </div>
                      </div>

                      {req.message && <div className={styles.message}>"{req.message}"</div>}
                    </div>

                    <div className={styles.cardActions}>
                      {(() => {
                        const { showChallengeNow, showShowInterest } = getBrowseCardActions(activeTab, req);

                        return (
                          <>
                            <Button
                              variant="secondary"
                              onClick={() => setCurrentIndex((prev) => Math.min(scoredRequests.length - 1, prev + 1))}
                            >
                              Pass
                              <X size={20} />
                            </Button>
                            {showChallengeNow && (
                              <Button
                                variant="tinder"
                                onClick={() => {
                                  if (!profile && !mockDataEnabled) {
                                    setShowLoginModal(true);
                                  } else {
                                    setIsSelectingTeam(true);
                                    setSelectingTeamPurpose('challenge');
                                    setTargetRequestId(req.id);
                                  }
                                }}
                              >
                                <Handshake size={20} />
                                Challenge Now
                              </Button>
                            )}
                            {showShowInterest && (
                              <Button
                                variant="tinder"
                                onClick={() =>
                                  window.open(
                                    `https://www.hattrick.org/Team/Team.aspx?TeamID=${req.team?.ht_team_id}`,
                                    '_blank',
                                    'noopener,noreferrer',
                                  )
                                }
                              >
                                <Heart size={20} weight="fill" />
                                Show Interest
                              </Button>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {showSuccessOverlay && (
                      <div className={styles.successOverlay}>
                        <Heart size={80} weight="fill" color="#fff" />
                        <h2>{mockDataEnabled ? 'Mock publish complete!' : 'Published!'}</h2>
                        {selectedTeam && (
                          <div style={{ marginBottom: '2rem' }}>
                            <p style={{ fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                              {getDisplayTeamName(selectedTeam.teamName, selectedTeam.genderId)}
                            </p>
                            <p>{matchType === '120min' ? '⚔️ 120 minute cup rules' : '⚽ 90 minute OK'}</p>
                            <p>
                              {location === 'domestic'
                                ? `🏠 my country only (${getLeagueNameById(selectedTeam.leagueId) || selectedTeam.countryName})`
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
                    <CaretRight />
                  </button>
                </div>
              );
            })()
          )}
        </div>
      ) : (
        <div className={styles.myRequests}>
          <div className={styles.myAdsHeader}>
            <h3>Your published ads</h3>
            <p>Here you can view, modivy and see activity on your own ads.</p>
          </div>
          {myRequests.length > 0 ? (
            <div className={styles.requestGrid}>
              {myRequests.map((req) => (
                <div key={req.id} className={`${styles.myRequestCard} ${styles[req.status]}`} style={{ padding: 0 }}>
                  <div className={styles.tinderCard}>
                    <div className={styles.cardTop}>
                      <div className={styles.cardArena}>
                        {req.team?.arena_image_url && (
                          <div className={styles.arenaFrame}>
                            <img src={req.team.arena_image_url} alt="Arena" />
                          </div>
                        )}
                      </div>
                      {req.status === 'open' && (
                        <div className={styles.inlineEditButtons}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            title="Edit Ad"
                            onClick={() => {
                              setSelectedHtTeamId(req.team?.ht_team_id || 0);
                              setIsPosting(true);
                            }}
                          >
                            <PencilSimple size={18} />
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            title="Delete Ad"
                            onClick={async () => {
                              if (mockDataEnabled) {
                                setMyRequests((prev) => prev.filter((item) => item.id !== req.id));
                                setRequests((prev) => prev.filter((item) => item.id !== req.id));
                                return;
                              }

                              if (confirm('Delete this friendly ad?')) {
                                const { error } = await supabase.from('matchmaker_requests').delete().eq('id', req.id);
                                if (!error) {
                                  void fetchMyRequests();
                                  void fetchRequests();
                                }
                              }
                            }}
                          >
                            <Trash size={18} />
                          </button>
                        </div>
                      )}
                      <div className={styles.cardRight}>
                        <div className={styles.teamInfo}>
                          <div className={styles.teamMain}>
                            {req.team?.logo_url ? (
                              <img src={req.team.logo_url} alt="" className={styles.teamLogo} />
                            ) : (
                              <Handshake size={48} className={styles.teamPlaceholder} />
                            )}
                            <div className={styles.teamText}>
                              <h2 className={styles.teamName} style={{ fontSize: '1.4rem' }}>
                                {getDisplayTeamName(req.team?.name || '', req.team?.gender_id)}
                              </h2>
                              <div className={styles.teamMeta}>
                                {req.team?.league_id && (
                                  <img
                                    src={`https://www.hattrick.org/Img/flags/${req.team.league_id}.png`}
                                    alt=""
                                    className={styles.flag}
                                  />
                                )}
                                <span>{getDisplayCountryName(req.team)}</span>
                              </div>
                            </div>
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
                                ? `Domestic (${getDisplayCountryName(req.team) || 'same country'})`
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
                        </div>
                        <div className={styles.adMetaRow}>
                          <span
                            className={`${styles.availabilityBadge} ${req.status === 'open' ? styles.good : styles.bad}`}
                            title="Based on how recently the ad was posted."
                          >
                            {req.status === 'open' ? getFreshnessLabel(req, nowMs).label : 'Matched'}
                          </span>
                        </div>
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
                    <div className={styles.activitySection}>
                      <div className={styles.activityHeader}>Activity</div>
                      <div className={styles.activityEmpty}>
                        <p>No activity yet.</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p>You haven't posted any teams this week.</p>
              <Button size="md" variant="tinder" onClick={handleStartPosting}>
                Post an Ad
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
              <select value={selectedHtTeamId} onChange={handleSelectTeamChange} className={styles.teamDropdown}>
                <option value={0}>Select a team</option>
                {postingTeamGroupsForModal.map((group) => (
                  <optgroup
                    key={group.status}
                    label={
                      group.status === 'available'
                        ? 'Available Now'
                        : group.status === 'long-term-only'
                          ? 'Long-term'
                          : 'Existing ads (update)'
                    }
                  >
                    {group.teams.map((team) => {
                      const selectable = team.availabilityStatus === 'available';
                      const labelParts = [getDisplayTeamName(team.teamName, team.genderId)];
                      if (team.is_mock) {
                        labelParts.push('(Mock)');
                      }
                      // Show availability label for non-available teams
                      if (!selectable) {
                        labelParts.push(`- ${getAvailabilityStatusLabel(team)}`);
                      }
                      if (team.availabilityReason) {
                        labelParts.push(`(${team.availabilityReason})`);
                      }

                      return (
                        <option key={team.teamId} value={team.teamId}>
                          {labelParts.filter(Boolean).join(' ')}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            ) : (
              <div className={styles.noTeamsMessage}>
                <Warning size={20} />
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
                <Info size={16} /> {teamsWarning}
              </p>
            )}
            {teamsError && (
              <p className={styles.warningText}>
                <Info size={16} /> {teamsError}
              </p>
            )}
            {publishError && (
              <p className={styles.warningText}>
                <Info size={16} /> {publishError}
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
              <input
                type="checkbox"
                checked={isLongTerm}
                onChange={(e) => setIsLongTerm(e.target.checked)}
                disabled={isLongTermLocked}
              />
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
              <h2>{mockDataEnabled ? 'Challenge prepared' : 'Ready for Kickoff?'}</h2>
              <p>
                {mockDataEnabled
                  ? 'This is a mock success flow. No booking has been sent and no database changes were made.'
                  : 'This is a manual arrangement flow. No booking has been sent yet.'}
              </p>
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
                  <span className={styles.matchTeamLabel}>Selected team</span>
                  <strong>{getDisplayTeamName(pendingMatch.team.teamName, pendingMatch.team.genderId)}</strong>
                </div>
                <div>
                  <span className={styles.matchTeamLabel}>Target team</span>
                  <strong>
                    {getDisplayTeamName(pendingMatch.request.team?.name || '', pendingMatch.request.team?.gender_id)}
                  </strong>
                </div>
                <div>
                  <span className={styles.matchTeamLabel}>HT Team ID</span>
                  <strong>{pendingMatch.request.team?.ht_team_id}</strong>
                </div>
                {mockDataEnabled && (
                  <div>
                    <span className={styles.matchTeamLabel}>Mock booking reference</span>
                    <strong>{`MOCK-${pendingMatch.request.id.slice(-6).toUpperCase()}`}</strong>
                  </div>
                )}
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
