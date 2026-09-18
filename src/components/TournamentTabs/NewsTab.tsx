'use client';

import React, { useEffect, useState } from 'react';
import { Question } from 'phosphor-react';
import { Button } from '../Button/Button';
import { SectionCard } from '../Card/SectionCard';
import { CompactAccordionWidget, type CompactAccordionItem } from '../CompactAccordionWidget/CompactAccordionWidget';
import { supabase } from '../../lib/supabase';
import styles from './NewsTab.module.sass';

interface NewsTeam {
  id: string;
  name: string;
  logo_url?: string;
  hattrick_user_id?: number;
  manager_name?: string;
}

export interface NewsPost {
  id: string;
  tournament_id?: string | null;
  tournament_slug?: string | null;
  tournament_name?: string | null;
  title?: string | null;
  content: string;
  author_name: string;
  author_team_id?: string | null;
  is_admin?: boolean;
  created_at: string;
}

export interface NewsReaction {
  post_id: string;
  user_id: string;
  reaction: string;
}

export interface NewsArticleProps {
  post: NewsPost;
  authorTeam?: NewsTeam | null;
  reactions?: NewsReaction[];
  currentUserId?: string | null;
  reactionAuthorNames?: Record<string, string>;
  onReaction?: (postId: string, reaction: string) => void;
  visitHref?: string;
  visitLabel?: string;
}

interface NewsTabProps {
  isActive: boolean;
  tournamentId: string;
  seasonNumber: number;
  teams: NewsTeam[];
  myHtUserId: string | null;
  isAdminAuthenticated: boolean;
  faqItems: CompactAccordionItem[];
}

const DEFAULT_TEAM_LOGO = '/default-logo.png';

export const NewsArticle: React.FC<NewsArticleProps> = ({
  post,
  authorTeam,
  reactions = [],
  currentUserId,
  reactionAuthorNames = {},
  onReaction,
  visitHref,
  visitLabel = 'Visit cup',
}) => (
  <article className={`${styles.post} ${post.is_admin ? styles.adminPost : ''}`}>
    <div className={styles.postHeader}>
      {authorTeam?.logo_url && <img src={authorTeam.logo_url} className={styles.postLogo} alt="" />}
      <span className={styles.postAuthor}>{post.author_name}</span>
      <span className={styles.postTime}>
        {new Date(post.created_at).toLocaleString('lv-LV', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Riga',
        })}
      </span>
    </div>
    {post.title && <h4 className={styles.postTitle}>{post.title}</h4>}
    <div className={styles.postContent}>{post.content}</div>
    {reactions.length > 0 && (
      <div className={styles.usedReactions} aria-label="Used reactions">
        {reactions.map((item, index) => (
          <span key={`${item.user_id}-${index}`} className={styles.usedReaction}>
            <span
              title={reactionAuthorNames[item.user_id] || `CHPP user ${item.user_id}`}
              aria-label={`${reactionAuthorNames[item.user_id] || `CHPP user ${item.user_id}`} reacted ${item.reaction}`}
            >
              {item.reaction}
            </span>
          </span>
        ))}
      </div>
    )}
    {onReaction && (
      <div className={styles.reactionBar}>
        {['😅', '💪', '🔥', '❤️', '🥶', '🍺', '😕', '🏆', '⚽️'].map((emoji) => (
          <button
            key={emoji}
            onClick={() => onReaction(post.id, emoji)}
            className={`${styles.reactionBtn} ${reactions.some((item) => item.user_id === currentUserId && item.reaction === emoji) ? styles.reactionSelected : ''}`}
            disabled={!currentUserId}
          >
            {emoji}
          </button>
        ))}
      </div>
    )}
    {visitHref && (
      <div className={styles.visitCupRow}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            window.location.href = visitHref;
          }}
        >
          {visitLabel}
        </Button>
      </div>
    )}
  </article>
);

export const NewsTab: React.FC<NewsTabProps> = ({
  isActive,
  tournamentId,
  seasonNumber,
  teams,
  myHtUserId,
  isAdminAuthenticated,
  faqItems,
}) => {
  const [newsPosts, setNewsPosts] = useState<NewsPost[]>([]);
  const [newNewsTitle, setNewNewsTitle] = useState('');
  const [newNewsContent, setNewNewsContent] = useState('');
  const [isPostingNews, setIsPostingNews] = useState(false);
  const [newsMode, setNewsMode] = useState<'admin' | 'team'>('team');
  const [newsReactions, setNewsReactions] = useState<Record<string, NewsReaction[]>>({});
  const reactionAuthorNames = Object.fromEntries(
    teams
      .filter((team) => team.hattrick_user_id)
      .map((team) => [String(team.hattrick_user_id), team.manager_name || team.name]),
  );

  useEffect(() => {
    if (!isActive) return;

    const fetchPosts = async () => {
      const { data } = await supabase
        .from('news_posts')
        .select('*')
        .eq('tournament_id', tournamentId)
        .eq('season_number', seasonNumber)
        .order('created_at', { ascending: false });
      const posts = (data as NewsPost[] | null) || [];
      setNewsPosts(posts);
      if (posts.length > 0) {
        const { data: reactionRows } = await supabase
          .from('news_reactions')
          .select('post_id, user_id, reaction')
          .in('post_id', posts.map((post) => post.id));
        setNewsReactions(
          Object.groupBy((reactionRows as NewsReaction[] | null) || [], (reaction) => reaction.post_id),
        );
      }
    };
    void fetchPosts();

    const channel = supabase
      .channel(`news:${tournamentId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'news_posts',
          filter: `tournament_id=eq.${tournamentId}`,
        },
        (payload) => {
          const post = payload.new as NewsPost & { season_number?: number | null };
          if (post.season_number === seasonNumber) {
            setNewsPosts((current) => [post, ...current]);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'news_reactions' },
        (payload) => {
          const reaction = payload.new as NewsReaction;
          if (!reaction.post_id) return;
          setNewsReactions((current) => {
            const existing = current[reaction.post_id] || [];
            return {
              ...current,
              [reaction.post_id]: [
                ...existing.filter((item) => item.user_id !== reaction.user_id),
                reaction,
              ],
            };
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isActive, seasonNumber, tournamentId]);

  const handlePostMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newNewsContent.trim()) return;

    setIsPostingNews(true);
    try {
      const myTeam = myHtUserId ? teams.find((team) => team.hattrick_user_id === Number(myHtUserId)) : null;
      const { error } = await supabase.from('news_posts').insert({
        tournament_id: tournamentId,
        season_number: seasonNumber,
        title: newNewsTitle.trim(),
        content: newNewsContent.trim(),
        author_name: newsMode === 'admin' ? 'Cup Press Release' : myTeam?.name || 'Guest',
        author_team_id: newsMode === 'admin' ? null : myTeam?.id || null,
        is_admin: newsMode === 'admin',
      });

      if (error) throw error;
      setNewNewsContent('');
      setNewNewsTitle('');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not post news.');
    } finally {
      setIsPostingNews(false);
    }
  };

  const handleAddReaction = async (postId: string, reaction: string) => {
    const userId = localStorage.getItem('my_ht_user_id');
    if (!userId) return;
    const { error } = await supabase.from('news_reactions').upsert(
      { post_id: postId, user_id: userId, reaction },
      { onConflict: 'post_id,user_id' },
    );
    if (error) alert(error.message);
    else
      setNewsReactions((current) => ({
        ...current,
        [postId]: [
          ...(current[postId] || []).filter((item) => item.user_id !== userId),
          { post_id: postId, user_id: userId, reaction },
        ],
      }));
  };

  const latestPost = newsPosts[0] || null;
  const olderPosts = newsPosts.slice(1);

  if (!isActive) return null;

  return (
    <div className={styles.newsLayout}>
      <div className={styles.guestbook}>
        <SectionCard title="Write a press release">
          <div className={styles.newsTabs}>
            <button className={newsMode === 'team' ? styles.active : ''} onClick={() => setNewsMode('team')}>
              Team News
            </button>
            {isAdminAuthenticated && (
              <button className={newsMode === 'admin' ? styles.active : ''} onClick={() => setNewsMode('admin')}>
                Announcement
              </button>
            )}
          </div>

          {newsMode === 'team' && (
            <div className={styles.postingTeamBranding}>
              {(() => {
                const myTeam = myHtUserId ? teams.find((team) => team.hattrick_user_id === Number(myHtUserId)) : null;
                return myTeam ? (
                  <div className={styles.branding}>
                    <img
                      src={myTeam.logo_url || DEFAULT_TEAM_LOGO}
                      alt={myTeam.name}
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = DEFAULT_TEAM_LOGO;
                      }}
                    />
                    <span>
                      Posting as: <strong>{myTeam.name}</strong>
                    </span>
                  </div>
                ) : (
                  <p>You don't have a team in this tournament.</p>
                );
              })()}
            </div>
          )}

          <form onSubmit={handlePostMessage} className={styles.postForm}>
            <div className={styles.newsInputGroup}>
              <input
                type="text"
                value={newNewsTitle}
                onChange={(event) => setNewNewsTitle(event.target.value)}
                placeholder="Article Title..."
                className={styles.postTitleInput}
              />
              <textarea
                value={newNewsContent}
                onChange={(event) => setNewNewsContent(event.target.value)}
                placeholder={newsMode === 'admin' ? 'Write a tournament announcement...' : "Share your team's news..."}
                className={styles.postTextarea}
                rows={3}
              />
            </div>
            <div className={styles.postActions}>
              <Button type="submit" variant="primary" disabled={isPostingNews || !newNewsContent.trim()}>
                {isPostingNews ? 'Posting...' : 'Post News'}
              </Button>
            </div>
          </form>
        </SectionCard>

        {newsPosts.length === 0 ? (
          <SectionCard title="🗞 120min Weekly">
            <p className={styles.noPosts}>No news yet.</p>
          </SectionCard>
        ) : (
          <div className={styles.weeklyPanels}>
            {latestPost && (
              <SectionCard title="🗞 120min Weekly" className={styles.weeklyPanel}>
                <NewsArticle
                  post={latestPost}
                  authorTeam={
                    latestPost.author_team_id ? teams.find((team) => team.id === latestPost.author_team_id) : null
                  }
                  reactions={newsReactions[latestPost.id]}
                  currentUserId={myHtUserId}
                  reactionAuthorNames={reactionAuthorNames}
                  onReaction={handleAddReaction}
                  visitHref={window.location.pathname}
                />
              </SectionCard>
            )}

            {olderPosts.map((post) => {
              const authorTeam = post.author_team_id ? teams.find((team) => team.id === post.author_team_id) : null;

              return (
                <SectionCard key={post.id} className={styles.weeklyPanel}>
                  <NewsArticle
                    post={post}
                    authorTeam={authorTeam}
                    reactions={newsReactions[post.id]}
                    currentUserId={myHtUserId}
                    reactionAuthorNames={reactionAuthorNames}
                    onReaction={handleAddReaction}
                    visitHref={window.location.pathname}
                  />
                </SectionCard>
              );
            })}
          </div>
        )}
      </div>

      <aside className={styles.newsSidebar}>
        <CompactAccordionWidget title="Tournament FAQ" icon={<Question size={20} weight="bold" />} items={faqItems} />
      </aside>
    </div>
  );
};
