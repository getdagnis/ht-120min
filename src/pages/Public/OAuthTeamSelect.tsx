import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Card } from '../../components/Card/Card';
import { Lineicons } from '@lineiconshq/react-lineicons';
import { Trophy1Outlined, ChevronLeftOutlined } from '@lineiconshq/free-icons';
import styles from './OAuthTeamSelect.module.sass';

interface ChppTeamOption {
  teamId: number;
  teamName: string;
  leagueName?: string;
  leagueLevelUnitName?: string;
  regionName?: string;
}

interface PendingJoinData {
  id: string;
  manager_name: string;
  teams_json: ChppTeamOption[];
  tournament_id: string;
  selection_token: string;
}

export const OAuthTeamSelect: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingData, setPendingData] = useState<PendingJoinData | null>(null);

  useEffect(() => {
    const fetchPending = async () => {
      const { data, error } = await supabase
        .from('oauth_pending_joins')
        .select('*')
        .eq('selection_token', token)
        .single();

      if (error || !data) {
        alert('Invalid or expired selection session.');
        navigate('/');
        return;
      }

      setPendingData(data);
      setLoading(false);
    };

    if (token) fetchPending();
  }, [token, navigate]);

  const handleSelect = async (team: ChppTeamOption) => {
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selection_token: token,
          team_id: team.teamId,
          team_name: team.teamName,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to complete join');

      navigate(`/t/${result.slug}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'An unknown error occurred');
      setSubmitting(false);
    }
  };

  if (loading || !pendingData) return <div style={{ padding: '4rem', textAlign: 'center' }}>Loading your teams...</div>;

  // 3. Validation Criteria
  const tournament = pendingData.tournament;
  const leagueType = tournament?.league_type || 'male';
  const countryLimit = tournament?.country_limit;

  const validTeams = pendingData.teams_json.filter((team: any) => {
    // League Type (male/female) - based on leagueName or similar logic
    // For now simple check: Hattrick Femme International (HFI) is id 3000
    const isFemaleLeague = team.leagueName?.includes('Femme') || team.leagueId === 3000;
    const isMaleLeague = !isFemaleLeague;

    if (leagueType === 'hfi' && !isFemaleLeague) return false;
    if (leagueType === 'male' && !isMaleLeague) return false;

    // Country Limit
    if (countryLimit && team.countryName !== countryLimit) return false;

    return true;
  });

  const criteriaText = `${leagueType === 'hfi' ? 'Hattrick Femme International' : 'male'} teams${
    countryLimit ? ` from ${countryLimit}` : ' from any country'
  }`;

  return (
    <div className={styles.container}>
      <Card variant="hero" title="Choose Your Team">
        <img src="/register.png" alt="Select Team" style={{ width: '100%', marginBottom: '1.5rem' }} />
        <p className={styles.welcomeText}>
          Welcome, <strong>{pendingData.manager_name}</strong>! Which team should join the tournament?
        </p>
        <p style={{ textAlign: 'center', fontSize: '0.85rem', marginBottom: '1.5rem', opacity: 0.8 }}>
          Only {criteriaText} can apply for this tournament.
        </p>

        <div className={styles.teamList}>
          {validTeams.map((team: ChppTeamOption) => (
            <div
              key={team.teamId}
              onClick={() => !submitting && handleSelect(team)}
              className={`${styles.teamCard} ${submitting ? styles.submitting : ''}`}
            >
              <div className={styles.teamMainInfo}>
                <Lineicons icon={Trophy1Outlined} size={24} className={styles.teamIcon} />
                <div>
                  <div className={styles.teamName}>{team.teamName}</div>
                  <div className={styles.teamMeta}>
                    {team.leagueLevelUnitName} • {team.regionName}
                  </div>
                </div>
              </div>
              <Lineicons icon={ChevronLeftOutlined} size={20} className="r-180" />
            </div>
          ))}
          {validTeams.length === 0 && (
            <p style={{ textAlign: 'center', padding: '2rem', fontStyle: 'italic' }}>
              None of your teams meet the criteria for this tournament.
            </p>
          )}
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {submitting && <p className={styles.joiningMessage}>Joining tournament...</p>}
          <Button variant="outline" onClick={() => navigate(-1)} disabled={submitting}>
            Cancel and Go Back
          </Button>
        </div>
      </Card>
    </div>
  );
};
