import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import type { MatchmakerRequest } from '../../utils/matchmaker';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { TeamSelectorModal } from '../../components/TeamSelectorModal/TeamSelectorModal';
import { AdminTestPanel } from '../../components/Admin/AdminTestPanel';
import { Avatar } from '../../components/Avatar/Avatar';
import { Handshake, X, Heart, Clock, Info, Warning } from 'phosphor-react';
import styles from './Matchmaker.module.sass';

interface ChppTeamOption {
  teamId: number;
  teamName: string;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryName?: string;
  leagueId?: number;
  leagueSystemId?: number;
  leagueName?: string;
  availabilityStatus?: 'available' | 'booked' | 'unknown';
  availabilityReason?: string;
}

const normalizeTeamList = (teams: ChppTeamOption[]) =>
  teams.map((team) => ({
    ...team,
    availabilityStatus: team.availabilityStatus ?? 'unknown',
  }));

export const Matchmaker: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'browse' | 'my-requests' | 'hfi'>('browse');
  const [requests, setRequests] = useState<MatchmakerRequest[]>([]);
  const isDev = import.meta.env.VITE_MATCHMAKER_DEV_MODE === 'true' || window.location.hostname === 'localhost';
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [myRequests, setMyRequests] = useState<MatchmakerRequest[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [matchedRequest, setMatchedRequest] = useState<MatchmakerRequest | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsWarning, setTeamsWarning] = useState<string | null>(null);
  const [myTeams, setMyTeams] = useState<ChppTeamOption[]>([]);
  const [isSelectingTeam, setIsSelectingTeam] = useState(false);
  const [selectingTeamPurpose, setSelectingTeamPurpose] = useState<'challenge' | 'post'>('post');
  const [targetRequestId, setTargetRequestId] = useState<string | null>(null);
  const [impersonatedManagerId] = useState<string>('');

  const effectiveManagerId = (isDev && impersonatedManagerId) || profile?.hattrick_user_id;

  // Form State
  const [selectedHtTeamId, setSelectedHtTeamId] = useState<number>(0);
  const [matchType, setMatchType] = useState<'120min' | '90min_acceptable'>('120min');
  const [location, setLocation] = useState<'domestic' | 'international_only' | 'any'>('any');
  const [homeAway, setHomeAway] = useState<'home' | 'away' | 'any'>('any');
  const [matchDay] = useState<string>('');
  const [timeWindow] = useState<string>('');
  const [message, setMessage] = useState('');
  const [isBackAndForth, setIsBackAndForth] = useState(false);
  const [isLongTerm, setIsLongTerm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const myHtId = profile?.hattrick_user_id ? Number(profile.hattrick_user_id) : null;

      let query = supabase
        .from('matchmaker_requests')
        .select(
          `
        *,
        team:teams!matchmaker_requests_team_id_fkey(
          name, ht_team_id, logo_url, country_name, league_id,
          gender_id, fanclub_size, arena_id, arena_size, arena_image_url
        ),
        profile:profiles!matchmaker_requests_manager_ht_id_fkey(manager_name, avatar_json, country_name, league_id)
        `,
        )

        .eq('status', 'open');
      if (myHtId && !isDev) {
        query = query.neq('manager_ht_id', myHtId);

        const { data: seen } = await supabase.from('matchmaker_views').select('request_id').eq('manager_ht_id', myHtId);

        if (seen && seen.length > 0) {
          query = query.not('id', 'in', `(${seen.map((s) => s.request_id).join(',')})`);
        }
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      setRequests((data as unknown as MatchmakerRequest[]) || []);
    } catch (err) {
      console.error('Error fetching requests:', err);
    } finally {
      setLoading(false);
    }
  }, [profile, isDev]);

  const fetchMyRequests = useCallback(async () => {
    if (!profile?.hattrick_user_id) return;
    const { data } = await supabase
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
      .eq('manager_ht_id', Number(profile.hattrick_user_id))
      .order('created_at', { ascending: false });
    setMyRequests((data as unknown as MatchmakerRequest[]) || []);
  }, [profile]);

  const refreshMyTeams = useCallback(async (managerIdOverride?: string) => {
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

      setSelectedHtTeamId((current) => {
        if (current && teams.some((team) => team.teamId === current && team.availabilityStatus === 'available'))
          return current;
        const availableTeam = teams.find((team) => team.availabilityStatus === 'available');
        return availableTeam?.teamId || teams[0]?.teamId || 0;
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
  }, [profile]);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      if (!isMounted) return;
      await Promise.all([fetchRequests(), fetchMyRequests()]);
    };
    void loadData();
    return () => {
      isMounted = false;
    };
  }, [fetchRequests, fetchMyRequests]);

  useEffect(() => {
    if (!profile?.hattrick_user_id) return;
    const timer = setTimeout(() => {
      void refreshMyTeams();
    }, 0);
    return () => clearTimeout(timer);
  }, [profile?.hattrick_user_id, refreshMyTeams]);

  const handleSkip = async () => {
    if (!requests[currentIndex]) return;

    if (profile?.hattrick_user_id) {
      await supabase.from('matchmaker_views').insert({
        manager_ht_id: profile.hattrick_user_id,
        request_id: requests[currentIndex].id,
        decision: 'skipped',
      });
    }

    setCurrentIndex((prev) => prev + 1);
  };

  const handleAccept = async (requestId: string, teamIdOverride?: number) => {
    if (!profile?.hattrick_user_id) {
      alert('Please sign in to challenge teams.');
      return;
    }

    const request = requests.find((r) => r.id === requestId);
    if (!request) return;

    if (myTeams.length === 0) {
      // Trigger team refresh if empty
      await refreshMyTeams();
    }

    const availableTeams = myTeams.filter((t) => t.availabilityStatus === 'available');

    if (availableTeams.length === 0) {
      alert('None of your teams are currently available for a friendly on next matchup dates.');
      return;
    }

    // JIT Team Selection
    if (!teamIdOverride && availableTeams.length > 1) {
      setTargetRequestId(requestId);
      setSelectingTeamPurpose('challenge');
      setIsSelectingTeam(true);
      return;
    }

    const selectedTeam = teamIdOverride ? myTeams.find((t) => t.teamId === teamIdOverride) : availableTeams[0];

    if (!selectedTeam || selectedTeam.availabilityStatus === 'booked') {
      alert('Selected team is not available.');
      return;
    }

    setIsSaving(true);
    try {
      // Get or create general team record for acceptor (atomically)
      const { data: teamRec, error: upsertErr } = await supabase
        .from('teams')
        .upsert(
          {
            ht_team_id: selectedTeam.teamId,
            name: selectedTeam.teamName,
            hattrick_user_id: profile.hattrick_user_id,
            manager_name: profile.manager_name,
            country_name: selectedTeam.countryName,
            tournament_id: null,
            active: true,
          },
          {
            onConflict: 'ht_team_id',
          },
        )
        .select('id')
        .single();

      if (upsertErr) throw upsertErr;
      const myTeamUuid = teamRec.id;

      const { error: updateError } = await supabase
        .from('matchmaker_requests')
        .update({
          status: 'matched',
          matched_with_team_id: myTeamUuid,
          matched_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (updateError) throw updateError;

      await supabase.from('matchmaker_views').insert({
        manager_ht_id: profile.hattrick_user_id,
        request_id: requestId,
        decision: 'matched',
      });

      setMatchedRequest(request);
      setIsSelectingTeam(false);
      setTargetRequestId(null);
    } catch (err) {
      console.error('Error accepting match:', err);
      alert('Failed to accept match. It might have been taken by someone else.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartPosting = async () => {
    if (!profile?.hattrick_user_id) {
      alert('Please sign in to create a Matchmaker profile.');
      return;
    }

    if (myTeams.length === 0) {
      await refreshMyTeams();
    }

    const availableTeams = myTeams.filter((t) => t.availabilityStatus === 'available');

    if (availableTeams.length === 0) {
      alert('None of your teams are currently available for a friendly.');
      return;
    }

    if (availableTeams.length > 1) {
      setSelectingTeamPurpose('post');
      setIsSelectingTeam(true);
    } else {
      setSelectedHtTeamId(availableTeams[0].teamId);
      setIsPosting(true);
    }
  };

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
          matchDay: homeAway === 'home' ? matchDay : null,
          timeWindow: homeAway === 'home' ? timeWindow : null,
          message: message.trim() || null,
          isBackAndForth,
          isLongTerm,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Could not publish this request right now.');
      }

      // Priority 1: Successful publish flow
      await fetchMyRequests();
      setActiveTab('my-requests');
      setIsPosting(false);
      setMessage('');
      setShowSuccessOverlay(true);

      // We could add a small local state for "Just Published" toast if needed
    } catch (err) {
      console.error('Error creating request:', err);
      setPublishError(
        err instanceof Error ? err.message : 'Could not publish this request right now. Please try again later.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const selectedTeam = myTeams.find((team) => team.teamId === selectedHtTeamId);
  const canPublish = !teamsLoading && !!selectedTeam && selectedTeam.availabilityStatus === 'available' && !isSaving;

  return (
    <div className={styles.view}>
      <header className={styles.headerContainer}>
        <div className={styles.tinderHeroCard}>
          <div className={styles.heroTopBar}>
            <span>Instant 120 min Friendly Matcher</span>
            <button className={styles.closeBtn} onClick={() => navigate('/')}>
              <X size={24} weight="bold" />
            </button>
          </div>

          <div className={styles.heroImageContainer}>
            <img src="/tinder-date3.png" alt="Tinder Date" className={styles.heroImage} />
            <div className={styles.heroBranding}>
              <h1>
                <span>HT-120min</span>
                <span>TINDER</span>
              </h1>
            </div>
          </div>

          <div className={styles.heroActions}>
            <p className={styles.heroSubtitle}>
              Find your next training partner. No awkward forum posts. No ghosting. Just swipe and challenge.
            </p>
            <Button size="lg" variant="secondary" onClick={handleStartPosting}>
              Create My Profile
            </Button>
          </div>
        </div>

        <div className={styles.tabs}>
          <button className={activeTab === 'browse' ? styles.active : ''} onClick={() => setActiveTab('browse')}>
            Find Match
          </button>
          <button className={activeTab === 'hfi' ? styles.active : ''} onClick={() => setActiveTab('hfi')}>
            HFI Only
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
          {(isDev || document.cookie.includes('issuperadmin=you bet')) && <AdminTestPanel />}
          {activeTab === 'hfi' && <div className={styles.hfiSubtitle}>Only female partners.</div>}
          {loading ? (
            <div className={styles.loading}>Finding teams...</div>
          ) : (
            (() => {
              const filteredRequests = requests.filter((req) => {
                if (activeTab === 'hfi') return req.gender_id === 2;
                return req.gender_id === 1 || !req.gender_id;
              });
              const currentRequest = filteredRequests[currentIndex];

              if (!currentRequest) {
                return (
                  <div className={styles.emptyState}>
                    <Handshake size={64} opacity={0.2} />
                    <h3>No requests found in this category</h3>
                    <p>Try checking back later or post your own ad!</p>
                  </div>
                );
              }

              return (
                <div className={styles.tinderCard}>
                  <div className={styles.cardHeader}>
                    {currentRequest.team?.arena_image_url && (
                      <div
                        className={styles.arenaBg}
                        style={{ backgroundImage: `url(${currentRequest.team.arena_image_url})` }}
                      />
                    )}
                    <div className={styles.managerInfo}>
                      <div className={styles.managerAvatar}>
                        <Avatar avatar={currentRequest.profile?.avatar_json || null} variant="circle" size={70} />
                      </div>
                      <div className={styles.managerMeta}>
                        <span className={styles.managerName}>{currentRequest.profile?.manager_name}</span>
                        <div className={styles.managerCountry}>
                          {currentRequest.profile?.league_id && (
                            <img
                              src={`https://www.hattrick.org/Img/flags/${currentRequest.profile.league_id}.png`}
                              alt=""
                              className={styles.miniFlag}
                            />
                          )}
                          {currentRequest.profile?.country_name && <span>{currentRequest.profile.country_name}</span>}
                        </div>
                      </div>
                    </div>

                    <div className={styles.teamBrand}>
                      <div className={styles.cardLogoWrapper}>
                        {currentRequest.team?.logo_url ? (
                          <img src={currentRequest.team.logo_url} alt="" />
                        ) : (
                          <Handshake size={64} opacity={0.2} />
                        )}
                      </div>
                      <h2 className={styles.teamName}>{currentRequest.team?.name}</h2>
                      <div className={styles.location}>
                        {currentRequest.team?.league_id && (
                          <img
                            src={`https://www.hattrick.org/Img/flags/${currentRequest.team.league_id}.png`}
                            alt=""
                            className={styles.miniFlag}
                          />
                        )}
                        <span>{currentRequest.team?.country_name}</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.cardBody}>
                    <div className={styles.matchBadge}>
                      <Clock size={16} />
                      <span>how long: 120 min</span>
                    </div>

                    <div className={styles.infoGrid}>
                      <div className={styles.infoItem}>
                        <span>❤️ Looking for:</span>
                        <span>
                          {currentRequest.match_type === '120min' ? '120 minute cup rules' : '⚽ 90 minute OK'}
                        </span>
                      </div>
                      <div className={styles.infoItem}>
                        <span>🌎 Will travel:</span>
                        <span>
                          {currentRequest.opponent_location === 'domestic' && `🏠 my country only`}
                          {currentRequest.opponent_location === 'international_only' && '🌍 Anywhere'}
                          {currentRequest.opponent_location === 'any' && '🗺 Anywhere'}
                        </span>
                      </div>
                      <div className={styles.infoItem}>
                        <span>🏟️ Venue:</span>
                        <span>
                          {currentRequest.home_away === 'home' && 'my place'}
                          {currentRequest.home_away === 'away' && 'your place'}
                          {currentRequest.home_away === 'any' && 'anywhere'}
                        </span>
                      </div>
                      {currentRequest.time_window && (
                        <div className={styles.infoItem}>
                          <span>🕒 Time:</span>
                          <span>
                            {currentRequest.match_day} {currentRequest.time_window}
                          </span>
                        </div>
                      )}
                      {(currentRequest.is_back_and_forth || currentRequest.is_long_term) && (
                        <div className={styles.infoItem}>
                          <span>💘 Extras:</span>
                          <span style={{ fontSize: '0.85rem' }}>
                            {currentRequest.is_back_and_forth && '🔄 Back-and-forth OK'}
                            {currentRequest.is_back_and_forth && currentRequest.is_long_term && <br />}
                            {currentRequest.is_long_term && '🗓 Long term training'}
                          </span>
                        </div>
                      )}
                    </div>

                    {currentRequest.message && (
                      <div className={styles.infoItem}>
                        <span>💬 About us:</span>
                        <p className={styles.message}>"{currentRequest.message}"</p>
                      </div>
                    )}
                  </div>

                  <div className={styles.cardActions}>
                    <Button variant="outline" onClick={handleSkip} disabled={isSaving} fullWidth>
                      <X size={20} weight="bold" /> NOPE
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => handleAccept(currentRequest.id)}
                      disabled={isSaving}
                      fullWidth
                      style={{ background: 'var(--tinder-bg)', borderColor: 'var(--borderDark)' }}
                    >
                      <Heart size={20} weight="fill" /> CHALLENGE
                    </Button>
                  </div>

                  {showSuccessOverlay && (
                    <div className={styles.successOverlay} style={{ background: 'rgba(58, 123, 213, 0.95)' }}>
                      <h2>✅ Your request is live</h2>
                      {selectedTeam && (
                        <div style={{ marginBottom: '2rem' }}>
                          <p style={{ fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                            {selectedTeam.teamName}
                          </p>
                          <p>{matchType === '120min' ? '⚔️ 120 minute cup rules' : '⚽ 90 minute OK'}</p>
                          <p>
                            {location === 'domestic'
                              ? `🏠 my country only (${selectedTeam.countryName})`
                              : location === 'international_only'
                                ? '🌍 will travel'
                                : '🗺 Anywhere'}
                          </p>
                          {homeAway === 'home' && matchDay && timeWindow && (
                            <p>
                              🏟 my place: {matchDay} {timeWindow}
                            </p>
                          )}
                        </div>
                      )}
                      <p>You will be notified when another manager accepts your match.</p>
                      <Button variant="tinder" onClick={() => setShowSuccessOverlay(false)}>
                        Awesome!
                      </Button>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      ) : (
        <div className={styles.myRequests}>
          <div className={styles.myAdsHeader}>
            <h3>Your active requests</h3>
            <p>You will be notified when another manager accepts your match.</p>
          </div>
          {myRequests.length > 0 ? (
            <div className={styles.requestGrid}>
              {myRequests.map((req) => (
                <div key={req.id} className={`${styles.myRequestCard} ${styles[req.status]}`}>
                  <div className={styles.requestHeader}>
                    <div className={styles.requestTeamInfo}>
                      {req.team?.league_id && (
                        <img
                          src={`https://www.hattrick.org/Img/flags/${req.team.league_id}.png`}
                          alt=""
                          className={styles.smallFlag}
                        />
                      )}
                      <strong>{req.team?.name}</strong>
                    </div>
                    <span className={`${styles.statusBadge} ${styles[req.status]}`}>{req.status.toUpperCase()}</span>
                  </div>

                  <div className={styles.requestBody}>
                    <div className={styles.reqDetail}>
                      <div className={styles.reqDetail}>
                        {req.opponent_location === 'domestic' && '🏠 Domestic'}
                        {req.opponent_location === 'international_only' && '🌍 International Only'}
                        {req.opponent_location === 'any' && '🗺 Anywhere'}
                      </div>
                      {req.is_long_term && <div className={styles.reqDetail}>🗓 Long term</div>}
                      {req.is_back_and_forth && <div className={styles.reqDetail}>🔄 Back-and-forth</div>}
                    </div>

                    <div className={styles.reqDetail}>
                      <Handshake size={16} />{' '}
                      <span>
                        {req.home_away === 'home' && '🏟 my place'}
                        {req.home_away === 'away' && '🚌 your place'}
                        {req.home_away === 'any' && '🤝 your place or my place'}
                      </span>
                    </div>
                    {req.time_window && (
                      <div className={styles.reqDetail}>
                        <Clock size={16} />{' '}
                        <span>
                          {req.match_day} {req.time_window}
                        </span>
                      </div>
                    )}
                    <div className={styles.reqDetail}>
                      <Clock size={16} opacity={0.5} />{' '}
                      <span>Expires: {new Date(req.expires_at).toLocaleDateString()}</span>
                    </div>

                    {req.status === 'matched' && req.matched_with_team_id && (
                      <div className={styles.matchNotice}>
                        <Heart size={16} weight="fill" color="#ff4b2b" />
                        <span>
                          Matched with <strong>{req.matched_team?.name}</strong>
                        </span>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            window.open(
                              `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${req.matched_team?.ht_team_id}`,
                              '_blank',
                            )
                          }
                        >
                          View Team
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className={styles.requestFooter}>
                    {req.status === 'open' && (
                      <Button
                        size="sm"
                        variant="zero"
                        className={styles.cancelBtn}
                        onClick={async () => {
                          if (confirm('Cancel this request?')) {
                            await supabase.from('matchmaker_requests').update({ status: 'cancelled' }).eq('id', req.id);
                            fetchMyRequests();
                          }
                        }}
                      >
                        Cancel Request
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p>You haven't posted any requests this week.</p>
              <Button variant="primary" onClick={() => setIsPosting(true)}>
                Post Your First Request
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
        title="Post a Friendly Request"
      >
        <form onSubmit={handleCreateRequest} className={styles.postModal}>
          <div className={styles.formGroup}>
            <label>Select Team</label>
            {teamsLoading ? (
              <div className={styles.noTeamsMessage}>
                <p>Let's check on your teams first...</p>
              </div>
            ) : myTeams.length > 0 ? (
              <>
                <div className={styles.teamSelector}>
                  {myTeams
                    .filter((t) => t.availabilityStatus === 'available')
                    .map((t) => (
                      <div
                        key={t.teamId}
                        className={`${styles.teamOption} ${selectedHtTeamId === t.teamId ? styles.selected : ''}`}
                        onClick={() => setSelectedHtTeamId(t.teamId)}
                      >
                        <div className={styles.teamOptionInfo}>
                          <strong>{t.teamName}</strong>
                          <span className={styles.teamMeta}>{t.countryName}</span>
                        </div>
                        <span className={`${styles.teamStatus} ${styles.available}`}>
                          <span className="mr-sm">👍</span> Available!
                        </span>
                      </div>
                    ))}
                </div>

                {myTeams.some((t) => t.availabilityStatus !== 'available') && (
                  <div className={styles.unavailableToggleSection}>
                    <button
                      type="button"
                      className={styles.toggleBtn}
                      onClick={() => setShowUnavailable(!showUnavailable)}
                    >
                      {showUnavailable ? 'Hide' : 'Show'} unavailable teams (
                      {myTeams.filter((t) => t.availabilityStatus !== 'available').length})
                    </button>

                    {showUnavailable && (
                      <div className={styles.teamSelector}>
                        {myTeams
                          .filter((t) => t.availabilityStatus !== 'available')
                          .map((t) => (
                            <div key={t.teamId} className={`${styles.teamOption} ${styles.disabled}`}>
                              <div className={styles.teamOptionInfo}>
                                <strong>{t.teamName}</strong>
                                <span className={styles.teamMeta}>{t.countryName}</span>
                                {t.availabilityReason && (
                                  <span className={styles.teamMeta}>{t.availabilityReason}</span>
                                )}
                              </div>
                              <span
                                className={`${styles.teamStatus} ${
                                  t.availabilityStatus === 'booked' ? styles.booked : styles.unknown
                                }`}
                              >
                                {t.availabilityStatus === 'booked' ? (
                                  <>
                                    <span className="mr-sm">⛔️</span> Not Available
                                  </>
                                ) : (
                                  'Status unknown'
                                )}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className={styles.noTeamsMessage}>
                <Warning size={20} weight="bold" />
                <p>Hattrick doesn't seem to be telling us about your clubs. Please try again in a moment.</p>
                <Button variant="zero" onClick={() => refreshMyTeams()} disabled={teamsLoading}>
                  Retry
                </Button>
              </div>
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
              {isSaving ? 'Publishing...' : 'Publish Request'}
            </Button>
          </div>
        </form>
      </Modal>

      {matchedRequest && (
        <Modal
          isOpen={!!matchedRequest}
          onClose={() => {
            setMatchedRequest(null);
            setCurrentIndex((prev) => prev + 1);
          }}
          title="It's a Match!"
        >
          <div className={styles.matchOverlay}>
            <h2>🎉 Boom!</h2>
            <p>
              You matched with <strong>{matchedRequest.team?.name}</strong>!
            </p>
            <div className={styles.matchActions}>
              <Button
                variant="primary"
                style={{ background: 'var(--tinder-bg)', borderColor: 'var(--borderDark)' }}
                onClick={() =>
                  window.open(
                    `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${matchedRequest.team?.ht_team_id}`,
                    '_blank',
                  )
                }
              >
                Send Challenge on Hattrick
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setMatchedRequest(null);
                  setCurrentIndex((prev) => prev + 1);
                }}
              >
                Awesome!
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <TeamSelectorModal
        isOpen={isSelectingTeam}
        onClose={() => setIsSelectingTeam(false)}
        teams={myTeams.filter((t) => t.availabilityStatus === 'available')}
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
    </div>
  );
};
