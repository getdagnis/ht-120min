import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../Button/Button';
import { Card } from '../Card/Card';
import { Lineicons } from '@lineiconshq/react-lineicons';
import { HandShakeOutlined, PlusOutlined, XmarkCircleOutlined, EnterOutlined } from '@lineiconshq/free-icons';
import styles from './FriendlyMarketplace.module.sass';

interface MarketplacePost {
  id: string;
  team_name: string;
  ht_team_id: number;
  message: string | null;
  status: string;
  created_at: string;
}

interface FriendlyMarketplaceProps {
  className?: string;
}

export const FriendlyMarketplace: React.FC<FriendlyMarketplaceProps> = ({ className = '' }) => {
  const [marketplacePosts, setMarketplacePosts] = useState<MarketplacePost[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [postTeamId, setPostTeamId] = useState('');
  const [postTeamName, setPostTeamName] = useState('');
  const [postMessage, setPostMessage] = useState('');
  const [isSavingPost, setIsSavingPost] = useState(false);

  const fetchMarketplace = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('marketplace_posts')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setMarketplacePosts(data || []);
    } catch (err) {
      console.error('Error fetching marketplace:', err);
    }
  }, []);

  const handlePostRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postTeamName.trim() || !postTeamId.trim()) return;

    setIsSavingPost(true);
    try {
      const { error } = await supabase.from('marketplace_posts').insert([
        {
          team_name: postTeamName.trim(),
          ht_team_id: parseInt(postTeamId.trim()),
          message: postMessage.trim() || null,
        },
      ]);

      if (error) throw error;
      setPostTeamId('');
      setPostTeamName('');
      setPostMessage('');
      setIsPosting(false);
      fetchMarketplace();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsSavingPost(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMarketplace();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchMarketplace]);

  return (
    <div className={className}>
      <div className={styles.sectionHeader}>
        <Lineicons icon={HandShakeOutlined} className={styles.sectionIcon} size={24} />
        <h2>Marketplace</h2>
      </div>
      <Card className={styles.marketplaceCard}>
        <div className={styles.marketplaceHeader}>
          <p>Looking for a single 120 min friendly partner? Post your request or apply below.</p>
          {!isPosting ? (
            <Button size="sm" onClick={() => setIsPosting(true)} variant="secondary" fullWidth>
              <Lineicons icon={PlusOutlined} size={16} /> Post Request
            </Button>
          ) : (
            <form onSubmit={handlePostRequest} className={styles.postForm}>
              <input
                type="number"
                placeholder="HT Team ID"
                value={postTeamId}
                onChange={(e) => setPostTeamId(e.target.value)}
                required
              />
              <input
                type="text"
                placeholder="Team Name"
                value={postTeamName}
                onChange={(e) => setPostTeamName(e.target.value)}
                required
              />
              <textarea
                placeholder="Message (optional)"
                value={postMessage}
                onChange={(e) => setPostMessage(e.target.value)}
                rows={2}
              />
              <div className={styles.postActions}>
                <Button type="submit" size="sm" variant="primary" disabled={isSavingPost}>
                  {isSavingPost ? 'Posting...' : 'Post'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setIsPosting(false)}>
                  <Lineicons icon={XmarkCircleOutlined} size={16} />
                </Button>
              </div>
            </form>
          )}
        </div>

        <div className={marketplacePosts.length > 0 ? styles.marketplaceList : ''}>
          {marketplacePosts.length > 0 ? (
            marketplacePosts.map((post) => (
              <div key={post.id} className={styles.marketItem}>
                <div className={styles.marketTeam}>
                  <strong>{post.team_name}</strong>
                  <span className={styles.marketDate}>{new Date(post.created_at).toLocaleDateString()}</span>
                </div>
                {post.message && <p className={styles.marketMsg}>{post.message}</p>}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    window.open(`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${post.ht_team_id}`, '_blank')
                  }
                >
                  Apply <Lineicons icon={EnterOutlined} size={12} />
                </Button>
              </div>
            ))
          ) : (
            <p className={styles.emptyMarket}>No open requests. Be the first to post!</p>
          )}
        </div>
      </Card>
    </div>
  );
};
