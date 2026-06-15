import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import type { MatchmakerRequest } from '../../utils/matchmaker';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { Handshake, X, Heart, Globe, Clock, Info, Warning } from 'phosphor-react';
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
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'browse' | 'my-requests'>('browse');
  const [requests, setRequests] = useState<MatchmakerRequest[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [myRequests, setMyRequests] = useState<MatchmakerRequest[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [matchedRequest, setMatchedRequest] = useState<MatchmakerRequest | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsWarning, setTeamsWarning] = useState<string | null>(null);
  const [myTeams, setMyTeams] = useState<ChppTeamOption[]>([]);

  // Form State
  const [selectedHtTeamId, setSelectedHtTeamId] = useState<number>(0);
  const [matchType, setMatchType] = useState<'120min' | '90min_acceptable'>('120min');
  const [location, setLocation] = useState<'domestic' | 'international' | 'any'>('any');
  const [homeAway, setHomeAway] = useState<'home' | 'away' | 'any'>('any');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const myHtId = profile?.hattrick_user_id;

      let query = supabase
        .from('matchmaker_requests')
        .select(
          `
          *,
          team:teams!matchmaker_requests_team_id_fkey(name, ht_team_id, logo_url, country_name, league_id:leage_id),
          profile:profiles(manager_name, avatar_json)
        `,
        )
        .eq('status', 'open');

      if (myHtId) {
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
  }, [profile]);

  const fetchMyRequests = useCallback(async () => {
    if (!profile?.hattrick_user_id) return;
    const { data } = await supabase
      .from('matchmaker_requests')
      .select(
        `
        *,
        team:teams(name, ht_team_id, logo_url, country_name, league_id:leage_id),
        matched_team:teams!matchmaker_requests_matched_with_team_id_fkey(name, ht_team_id, logo_url, country_name)
      `,
      )
      .eq('manager_ht_id', profile.hattrick_user_id)
      .order('created_at', { ascending: false });
    setMyRequests((data as unknown as MatchmakerRequest[]) || []);
  }, [profile]);

  const refreshMyTeams = useCallback(async () => {
    if (!profile?.hattrick_user_id) return;

    setTeamsLoading(true);
    setTeamsError(null);
    setTeamsWarning(null);

    try {
      const res = await fetch(`/api/matchmaker/teams?managerId=${profile.hattrick_user_id}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not refresh your teams from Hattrick.');
      }

      const teams = normalizeTeamList((data.teams as ChppTeamOption[]) || []);
      setMyTeams(teams);

      setSelectedHtTeamId((current) => {
        if (current && teams.some((team) => team.teamId === current)) return current;
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
    if (!profile?.hattrick_user_id || !requests[currentIndex]) return;

    await supabase.from('matchmaker_views').insert({
      manager_ht_id: profile.hattrick_user_id,
      request_id: requests[currentIndex].id,
      decision: 'skipped',
    });

    setCurrentIndex((prev) => prev + 1);
  };

  const handleAccept = async () => {
    if (!profile?.hattrick_user_id || !requests[currentIndex]) return;

    if (myTeams.length === 0) {
      alert('You need a verified team to accept matches.');
      return;
    }

    setIsSaving(true);
    try {
      const myTeam = myTeams.find((team) => team.availabilityStatus !== 'booked') ?? myTeams[0];

      // Get or create general team record for acceptor (atomically)
      const { data: teamRec, error: upsertErr } = await supabase
        .from('teams')
        .upsert(
          {
            ht_team_id: myTeam.teamId,
            name: myTeam.teamName,
            hattrick_user_id: profile.hattrick_user_id,
            manager_name: profile.manager_name,
            country_name: myTeam.countryName,
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
        .eq('id', requests[currentIndex].id);

      if (updateError) throw updateError;

      await supabase.from('matchmaker_views').insert({
        manager_ht_id: profile.hattrick_user_id,
        request_id: requests[currentIndex].id,
        decision: 'matched',
      });

      setMatchedRequest(requests[currentIndex]);
    } catch (err) {
      console.error('Error accepting match:', err);
      alert('Failed to accept match. It might have been taken by someone else.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.hattrick_user_id || !selectedHtTeamId) return;

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
        body: JSON.stringify({
          managerId: profile.hattrick_user_id,
          teamId: selectedHtTeamId,
          matchType,
          opponentLocation: location,
          homeAway,
          message: message.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Could not publish this request right now.');
      }

      setIsPosting(false);
      await refreshMyTeams();
      fetchMyRequests();
      setMessage('');
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
  const availableTeamCount = myTeams.filter((team) => team.availabilityStatus === 'available').length;
  const canPublish = !teamsLoading && !!selectedTeam && selectedTeam.availabilityStatus === 'available' && !isSaving;

  const currentRequest = requests[currentIndex];

  return (
    <div className={styles.view}>
      <section className={styles.hero}>
        <span className={styles.stats}>🤝 120min Matchmaker</span>
        <h1>120 min Tinder</h1>
        <p>Find your next 120 minute training opponent in seconds. No forums, no waiting.</p>
        <Button size="lg" variant="primary" onClick={() => setIsPosting(true)}>
          Post a Request
        </Button>
      </section>

      <div className={styles.tabs}>
        <button className={activeTab === 'browse' ? styles.active : ''} onClick={() => setActiveTab('browse')}>
          Browse Opponents
        </button>
        <button
          className={activeTab === 'my-requests' ? styles.active : ''}
          onClick={() => setActiveTab('my-requests')}
        >
          My Requests
        </button>
      </div>

      {activeTab === 'browse' ? (
        <div className={styles.browserContainer}>
          {loading ? (
            <div className={styles.loading}>Finding teams...</div>
          ) : currentRequest ? (
            <div className={styles.tinderCard}>
              <div className={styles.cardHeader}>
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
                    <img src={`https://www.hattrick.org/Img/flags/${currentRequest.team.league_id}.png`} alt="" />
                  )}
                  <span>{currentRequest.team?.country_name}</span>
                </div>
              </div>

              <div className={styles.cardBody}>
                <div className={styles.infoGrid}>
                  <div className={styles.infoItem}>
                    <span>Match Type</span>
                    <span>{currentRequest.match_type === '120min' ? '⚔️ 120 min' : '⚽ 90 min OK'}</span>
                  </div>
                  <div className={styles.infoItem}>
                    <span>Location</span>
                    <span>
                      {currentRequest.opponent_location === 'domestic' && '🏠 Domestic'}
                      {currentRequest.opponent_location === 'international' && '🌍 International'}
                      {currentRequest.opponent_location === 'any' && '🗺 Any'}
                    </span>
                  </div>
                  <div className={styles.infoItem}>
                    <span>Venue</span>
                    <span>
                      {currentRequest.home_away === 'home' && '🏟 Home'}
                      {currentRequest.home_away === 'away' && '🚌 Away'}
                      {currentRequest.home_away === 'any' && '🤝 Any'}
                    </span>
                  </div>
                  <div className={styles.infoItem}>
                    <span>Manager</span>
                    <span>{currentRequest.profile?.manager_name}</span>
                  </div>
                </div>

                {currentRequest.message && <p className={styles.message}>"{currentRequest.message}"</p>}
              </div>

              <div className={styles.cardActions}>
                <button className={styles.skipBtn} onClick={handleSkip} disabled={isSaving}>
                  <X size={24} weight="bold" /> SKIP
                </button>
                <button className={styles.acceptBtn} onClick={handleAccept} disabled={isSaving}>
                  <Heart size={24} weight="fill" /> ACCEPT MATCH
                </button>
              </div>

              {matchedRequest?.id === currentRequest.id && (
                <div className={styles.successOverlay}>
                  <h2>🎉 It's a Match!</h2>
                  <p>
                    You matched with <strong>{currentRequest.team?.name}</strong>!
                  </p>
                  <Button
                    variant="primary"
                    onClick={() =>
                      window.open(
                        `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${currentRequest.team?.ht_team_id}`,
                        '_blank',
                      )
                    }
                  >
                    Send Challenge on Hattrick
                  </Button>
                  <Button
                    variant="zero"
                    onClick={() => {
                      setMatchedRequest(null);
                      setCurrentIndex((prev) => prev + 1);
                    }}
                  >
                    Continue Browsing
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <Handshake size={64} opacity={0.3} />
              <h3>No more opponents found</h3>
              <p>Check back later or post your own request!</p>
              <Button variant="primary" onClick={fetchRequests} className={styles.mt1}>
                Refresh
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.myRequests}>
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
                      <Globe size={16} /> <span>{req.opponent_location}</span>
                    </div>
                    <div className={styles.reqDetail}>
                      <Clock size={16} /> <span>Expires: {new Date(req.expires_at).toLocaleDateString()}</span>
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
                {availableTeamCount === 0 && (
                  <div className={styles.noTeamsMessage}>
                    <img src="/warn-red.png" alt="Warning" width={48} />
                    <p>
                      All your teams seem to be booked already on next matchup dates.{' '}
                      <a
                        href="https://stage.hattrick.org/MyHattrick/Inbox/?actionType=newMail&userId=8777402"
                        target="_blank"
                      >
                        Report a mistake
                      </a>{' '}
                      or come back next week!
                    </p>
                    <Button variant="secondaryInverse" onClick={refreshMyTeams} disabled={teamsLoading} size="sm">
                      Check Again
                    </Button>
                  </div>
                )}
                <div className={styles.teamSelector}>
                  {myTeams.map((t) => (
                    <div
                      key={t.teamId}
                      className={`${styles.teamOption} ${selectedHtTeamId === t.teamId ? styles.selected : ''} ${
                        t.availabilityStatus === 'booked' ? styles.disabled : ''
                      }`}
                      onClick={() => {
                        if (t.availabilityStatus === 'booked') {
                          setSelectedHtTeamId(t.teamId);
                        }
                      }}
                    >
                      <div className={styles.teamOptionInfo}>
                        <strong>{t.teamName}</strong>
                        <span className={styles.teamMeta}>{t.countryName}</span>
                        {t.availabilityReason && t.availabilityStatus === 'available' && (
                          <span className={styles.teamMeta}>{t.availabilityReason}</span>
                        )}
                      </div>
                      <span
                        className={`${styles.teamStatus} ${
                          t.availabilityStatus === 'available'
                            ? styles.available
                            : t.availabilityStatus === 'booked'
                              ? styles.booked
                              : styles.unknown
                        }`}
                      >
                        {t.availabilityStatus === 'available' && (
                          <>
                            <span className="mr-sm">👍</span> <>Available!</>
                          </>
                        )}
                        {t.availabilityStatus === 'booked' && (
                          <>
                            <span className="mr-sm">⛔️</span> <>Not Available!</>
                          </>
                        )}
                        {t.availabilityStatus === 'unknown' && 'Status unknown'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.noTeamsMessage}>
                <Warning size={20} weight="bold" />
                <p>Hattrick doesn't seem to be telling us about your clubs. Please try again in a moment.</p>
                <Button variant="zero" onClick={refreshMyTeams} disabled={teamsLoading}>
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
              onChange={(e) => setLocation(e.target.value as 'domestic' | 'international' | 'any')}
            >
              <option value="any">Anywhere</option>
              <option value="domestic">Domestic Only</option>
              <option value="international">International Allowed</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Venue Preference</label>
            <select value={homeAway} onChange={(e) => setHomeAway(e.target.value as 'home' | 'away' | 'any')}>
              <option value="any">No Preference</option>
              <option value="home">Home</option>
              <option value="away">Away</option>
            </select>
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
    </div>
  );
};
