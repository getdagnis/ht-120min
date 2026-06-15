import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../Button/Button';
import { Card } from '../Card/Card';
import { Handshake, ArrowRight, Heart, HeartBreak } from 'phosphor-react';
import styles from './MatchmakerTeaser.module.sass';

interface MatchmakerTeaserProps {
  className?: string;
}

interface RecentRequest {
  id: string;
  match_type: string;
  opponent_location: string;
  team: {
    name: string;
    country_name: string;
    league_id: number;
  } | null;
}

export const MatchmakerTeaser: React.FC<MatchmakerTeaserProps> = ({ className = '' }) => {
  const navigate = useNavigate();
  const [activeCount, setActiveCount] = useState(0);
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      // Get count of open requests
      const { count } = await supabase
        .from('matchmaker_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open');

      setActiveCount(count || 0);

      // Get 2 latest requests
      const { data } = await supabase
        .from('matchmaker_requests')
        .select(
          `
          id,
          match_type,
          opponent_location,
          team:teams(name, country_name, league_id:leage_id)
        `,
        )
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(2);

      setRecentRequests((data as unknown as RecentRequest[]) || []);
    };

    fetchData();
  }, []);

  return (
    <div className={`${styles.wrapper} ${className}`}>
      <div className={styles.sectionHeader}>
        <HeartBreak size={24} weight="regular" className={styles.sectionIcon} />
        <h2>120 min Tinder</h2>
      </div>

      <Card className={styles.teaserCard}>
        <div className={styles.pulse}>
          <div className={styles.pulseDot}></div>
          <span>
            🔥 <strong>{activeCount} teams</strong> looking for a matchup
          </span>
        </div>

        <p className={styles.description}>Find your next 120 minute training partner the contemporary way.</p>

        <Button variant="primary" fullWidth onClick={() => navigate('/matchmaker')} className={styles.cta}>
          Find My Match <ArrowRight size={18} weight="bold" />
        </Button>

        {recentRequests.length > 0 && (
          <div className={styles.recentList}>
            <span className={styles.recentLabel}>Latest searches:</span>
            {recentRequests.map((req) => (
              <div key={req.id} className={styles.recentItem}>
                <div className={styles.teamLine}>
                  {req.team?.league_id && (
                    <img
                      src={`https://www.hattrick.org/Img/flags/${req.team.league_id}.png`}
                      alt=""
                      className={styles.flag}
                    />
                  )}
                  <strong>{req.team?.name}</strong>
                </div>
                <div className={styles.meta}>
                  {req.match_type === '120min' ? '120m' : '90m'} • {req.opponent_location}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
