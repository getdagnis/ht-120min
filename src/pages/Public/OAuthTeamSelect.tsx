import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Card } from '../../components/Card/Card';
import { Button } from '../../components/Button/Button';
import { Lineicons } from '@lineiconshq/react-lineicons';
import { Trophy1Outlined, ChevronRightOutlined } from '@lineiconshq/free-icons';

interface ChppTeamOption {
  teamId: number;
  teamName: string;
  leagueName?: string;
  leagueLevelUnitName?: string;
  regionName?: string;
}

export const OAuthTeamSelect: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);

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
    } catch (err: any) {
      alert(err.message);
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: '4rem', textAlign: 'center' }}>Loading your teams...</div>;

  return (
    <div style={{ maxWidth: '40rem', margin: '0 auto', padding: '2rem 1rem' }}>
      <Card variant="hero" title="Choose Your Team">
        <p style={{ marginBottom: '2rem', textAlign: 'center', opacity: 0.9 }}>
          Welcome, <strong>{pendingData.manager_name}</strong>! Which team should join the tournament?
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {pendingData.teams_json.map((team: ChppTeamOption) => (
            <div
              key={team.teamId}
              onClick={() => !submitting && handleSelect(team)}
              style={{
                padding: '1.25rem',
                background: 'var(--bg-transp2)',
                border: '1px solid var(--border)',
                borderRadius: '0.75rem',
                cursor: submitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                transition: 'all 0.2s ease',
                opacity: submitting ? 0.6 : 1,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <Lineicons icon={Trophy1Outlined} size={24} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-h)' }}>{team.teamName}</div>
                  <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                    {team.leagueLevelUnitName} • {team.regionName}
                  </div>
                </div>
              </div>
              <Lineicons icon={ChevronRightOutlined} size={20} />
            </div>
          ))}
        </div>

        {submitting && (
          <p style={{ marginTop: '2rem', textAlign: 'center', fontStyle: 'italic' }}>Joining tournament...</p>
        )}
      </Card>
    </div>
  );
};
