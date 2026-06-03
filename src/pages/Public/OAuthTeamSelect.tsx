import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Card } from '../../components/Card/Card';
import { Lineicons } from '@lineiconshq/react-lineicons';
import { Trophy1Outlined, ChevronLeftOutlined } from '@lineiconshq/free-icons';
import styles from './OAuthTeamSelect.module.sass';
import { Button } from '../../components/Button/Button';

interface ChppTeamOption {
  teamId: number;
  teamName: string;
  leagueName?: string;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryName?: string;
}

interface PendingJoinData {
  id: string;
  manager_name: string;
  teams_json: ChppTeamOption[];
  tournament_id: string | null;
  selection_token: string;
}

export const OAuthTeamSelect: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingData, setPendingData] = useState<PendingJoinData | null>(null);
  const [tournamentRules, setTournamentRules] = useState<any>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
  }, [redirectUrl]);

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

      // Fetch tournament rules if ID exists (joining an existing tournament)
      if (data.tournament_id) {
        const { data: tData } = await supabase
          .from('tournaments')
          .select('league_category, country_limit')
          .eq('id', data.tournament_id)
          .single();
        setTournamentRules(tData);
      } else {
        // In creation mode, rules might not be in DB yet. 
        // We'll trust the filtered list from the callback or pass defaults.
        setTournamentRules({ league_category: 'male', country_limit: null });
      }
      
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

      if (result.redirect) {
        setRedirectUrl(result.redirect);
      } else {
        navigate(`/t/${result.slug}`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'An unknown error occurred');
      setSubmitting(false);
    }
  };

  if (loading || !pendingData || !tournamentRules) return <div className={styles.loading}>Loading your teams...</div>;

  const leagueCategory = tournamentRules.league_category || 'male';
  const countryLimit = tournamentRules.country_limit;

  const validTeams = pendingData.teams_json; // callback already filters them

  const criteriaText = `${leagueCategory === 'hfi' ? 'Hattrick Femme International' : 'male'} teams${
    countryLimit ? ` from ${countryLimit}` : ' from any country'
  }`;

  return (
    <div className={styles.container}>
      <Card variant="hero" title="Choose Your Team">
        <img src="/register.png" alt="Select Team" className={styles.heroImg} />
        <p className={styles.welcomeText}>
          Welcome, <strong>{pendingData.manager_name}</strong>! Which team should join the tournament?
        </p>
        <p className={styles.criteria}>
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
            <p className={styles.noTeams}>
              None of your teams meet the criteria for this tournament.
            </p>
          )}
        </div>

        <div className={styles.footerActions}>
          {submitting && <p className={styles.joiningMessage}>Joining tournament...</p>}
          <Button variant="outline" onClick={() => navigate(-1)} disabled={submitting}>
            Cancel and Go Back
          </Button>
        </div>
      </Card>
    </div>
  );
};
