import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../Button/Button';
import { Card } from '../Card/Card';
import { ArrowRight, HeartBreak } from 'phosphor-react';
import { getDisplayTeamName } from '../../utils/matchmaker';
import { getMockMatchmakerRequests, isMatchmakerMockDataEnabled } from '../../mock/matchmaker';
import styles from './TinderWidget.module.sass';

interface MatchmakerTeaserProps {
  className?: string;
}

interface RecentRequest {
  id: string;
  match_type: string;
  opponent_location: string;
  is_mock?: boolean;
  team: {
    name: string;
    country_name: string;
    league_id: number;
    gender_id?: number;
  } | null;
}

export const TinderWidget: React.FC<MatchmakerTeaserProps> = ({ className = '' }) => {
  const navigate = useNavigate();
  const mockDataEnabled = isMatchmakerMockDataEnabled();
  const [activeCount, setActiveCount] = useState(0);
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (mockDataEnabled) {
        const mockRequests = getMockMatchmakerRequests();
        const mockRecentRequests: RecentRequest[] = mockRequests.slice(0, 2).map((request) => ({
          id: request.id,
          match_type: request.match_type,
          opponent_location: request.opponent_location,
          is_mock: request.is_mock,
          team: request.team
            ? {
                name: request.team.name,
                country_name: request.team.country_name ?? '',
                league_id: request.team.league_id ?? 0,
                gender_id: request.team.gender_id,
              }
            : null,
        }));

        setActiveCount(mockRequests.length);
        setRecentRequests(mockRecentRequests);
        return;
      }

      const { count } = await supabase
        .from('matchmaker_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open');

      // Get 2 latest requests
      const { data } = await supabase
        .from('matchmaker_requests')
        .select(
          `
          id,
          match_type,
          opponent_location,
          team:teams(name, country_name, league_id, gender_id)
        `,
        )
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(2);

      const unique = Array.from(
        new Map(((data as unknown as RecentRequest[]) || []).map((request) => [request.id, request])).values(),
      ).slice(0, 2);
      setActiveCount(count || 0);
      setRecentRequests(unique);
    };

    fetchData();
  }, [mockDataEnabled]);

  return (
    <div className={`${styles.wrapper} ${className}`}>
      <div className={styles.sectionHeader}>
        <HeartBreak size={24} weight="regular" className={styles.sectionIcon} />
        <h2>120 min Tinder</h2>
      </div>

      <Card className={styles.teaserCard}>
        <div className={styles.cardTop}>
          <img src={`/tinder3.svg`} width={32} height={32} alt="" className={styles.tinderImage} />
          <h2>HT-120min Tinder</h2>
        </div>
        <div className={styles.pulse}>
          <div className={styles.pulseDot}></div>
          <span>
            🔥 <strong>{activeCount} teams</strong> looking for a matchup
          </span>
        </div>

        <p className={styles.description}>Find your next 120 minute training partner the modern way.</p>

        <Button variant="primary" fullWidth onClick={() => navigate('/tinder')} className={styles.cta}>
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
                  <strong>{getDisplayTeamName(req.team?.name || '', req.team?.gender_id)}</strong>
                  {req.is_mock && <span className={styles.mockTag}>Mock</span>}
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
