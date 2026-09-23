'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Question } from 'phosphor-react';
import { Button } from '../Button/Button';
import { NoticeDialog } from '../Modal/NoticeDialog';
import { useNoticeDialog } from '../Modal/useNoticeDialog';
import { SectionCard } from '../Card/SectionCard';
import { CompactAccordionWidget, type CompactAccordionItem } from '../CompactAccordionWidget/CompactAccordionWidget';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../i18n/LocaleProvider';
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
  season_number?: number | null;
  round_number?: number | null;
  tournament_slug?: string | null;
  tournament_name?: string | null;
  title?: string | null;
  content: string;
  author_name: string;
  author_team_id?: string | null;
  is_admin?: boolean;
  is_round_report?: boolean;
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
  tournamentImageUrl?: string | null;
  adminBylineLabel?: string | null;
  adminBylineHref?: string | null;
  visitHref?: string;
  visitLabel?: string;
}

interface NewsTabProps {
  isActive: boolean;
  tournamentId: string;
  seasonNumber: number;
  teams: NewsTeam[];
  myHtUserId: string | null;
  myManagerName: string | null;
  isAdminAuthenticated: boolean;
  canPublishAnnouncements: boolean;
  tournamentImageUrl?: string | null;
  faqItems: CompactAccordionItem[];
}

type NewsMode = 'admin' | 'team';

interface NewsDraft {
  title: string;
  content: string;
  roundSummaryRoundNumber?: number;
}

const OFFICIAL_PRESS_BYLINE = 'Tournament Update';

function getOfficialPressAuthor(authorName: string) {
  const legacyByline = /^(?:Cup Press Release|Tournament Update)(?:\s+\(?(?:by\s+)?(.+?)\)?)?$/i.exec(authorName.trim());
  return legacyByline?.[1]?.trim() || null;
}

function getNewsDraftStorageKey(tournamentId: string, seasonNumber: number, mode: NewsMode, managerId: string | null) {
  return `ht120:news-draft:${tournamentId}:${seasonNumber}:${mode}:${mode === 'admin' ? 'cup-press' : managerId || 'guest'}`;
}

function getNewsModeStorageKey(tournamentId: string, managerId: string | null) {
  return `ht120:news-mode:${tournamentId}:${managerId || 'guest'}`;
}

function readNewsMode(storageKey: string): NewsMode | null {
  try {
    const value = sessionStorage.getItem(storageKey);
    return value === 'admin' || value === 'team' ? value : null;
  } catch {
    return null;
  }
}

function persistNewsMode(storageKey: string, mode: NewsMode) {
  try {
    sessionStorage.setItem(storageKey, mode);
  } catch {
    // Session storage can be unavailable; falling back to Team News is safe.
  }
}

function readNewsDraft(storageKey: string): NewsDraft | null {
  try {
    const value = sessionStorage.getItem(storageKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<NewsDraft>;
    if (typeof parsed.title !== 'string' || typeof parsed.content !== 'string') return null;
    return {
      title: parsed.title,
      content: parsed.content,
      roundSummaryRoundNumber:
        typeof parsed.roundSummaryRoundNumber === 'number' && Number.isInteger(parsed.roundSummaryRoundNumber)
          ? parsed.roundSummaryRoundNumber
          : undefined,
    };
  } catch {
    return null;
  }
}

function persistNewsDraft(storageKey: string, draft: NewsDraft) {
  try {
    if (!draft.title && !draft.content) sessionStorage.removeItem(storageKey);
    else sessionStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // Session storage can be unavailable or full; the in-memory editor remains usable.
  }
}

function prependNewsPost(posts: NewsPost[], post: NewsPost) {
  return [post, ...posts.filter((current) => current.id !== post.id)];
}

export const NewsArticle: React.FC<NewsArticleProps> = ({
  post,
  authorTeam,
  reactions = [],
  currentUserId,
  reactionAuthorNames = {},
  onReaction,
  tournamentImageUrl,
  adminBylineLabel,
  adminBylineHref,
  visitHref,
  visitLabel = 'Visit cup',
}) => {
  const { locale } = useLocale();
  const dateLocale = locale === 'lv' ? 'lv-LV' : 'en-GB';
  const officialPressAuthor = post.is_admin ? getOfficialPressAuthor(post.author_name) : null;

  return (
    <article className={`${styles.post} ${post.is_admin ? styles.adminPost : ''}`}>
      <div className={styles.postHeader}>
        {authorTeam?.logo_url && <img src={authorTeam.logo_url} className={styles.postLogo} alt="" />}
        <span className={styles.postAuthor}>
          {post.is_admin ? (
            adminBylineHref ? (
              <a href={adminBylineHref} className={styles.postAuthorLink}>
                <strong>{adminBylineLabel || OFFICIAL_PRESS_BYLINE}</strong>
              </a>
            ) : (
              <>
                <strong>{adminBylineLabel || OFFICIAL_PRESS_BYLINE}</strong>
              {officialPressAuthor && <span className={styles.officialPressAuthor}> (by {officialPressAuthor})</span>}
              </>
            )
          ) : (
            post.author_name
          )}
        </span>
        <span className={styles.postTime}>
          {new Date(post.created_at).toLocaleString(dateLocale, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Riga',
          })}
        </span>
      </div>
      {post.title && <h4 className={styles.postTitle}>{post.title}</h4>}
      <div className={styles.postContent}>
        {post.is_admin && tournamentImageUrl && (
          <img src={tournamentImageUrl} className={styles.tournamentPressImage} alt="" />
        )}
        {post.content}
      </div>
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
};

export const NewsTab: React.FC<NewsTabProps> = ({
  isActive,
  tournamentId,
  seasonNumber,
  teams,
  myHtUserId,
  myManagerName,
  isAdminAuthenticated,
  canPublishAnnouncements,
  tournamentImageUrl = null,
  faqItems,
}) => {
  const { notice, showNotice: alert, closeNotice } = useNoticeDialog();
  const [newsPosts, setNewsPosts] = useState<NewsPost[]>([]);
  const [newNewsTitle, setNewNewsTitle] = useState('');
  const [newNewsContent, setNewNewsContent] = useState('');
  const [isPostingNews, setIsPostingNews] = useState(false);
  const [isCreatingRoundSummary, setIsCreatingRoundSummary] = useState(false);
  const [hasGeneratedRoundSummary, setHasGeneratedRoundSummary] = useState(false);
  const [generatedRoundNumber, setGeneratedRoundNumber] = useState<number | null>(null);
  const [roundSummaryPromptRevision, setRoundSummaryPromptRevision] = useState<string | null>(null);
  const [roundSummaryElapsedSeconds, setRoundSummaryElapsedSeconds] = useState(0);
  const roundSummaryTimerRef = useRef<number | null>(null);
  const [roundSummaryEligibility, setRoundSummaryEligibility] = useState<{
    seasonNumber: number;
    roundNumber: number;
  } | null>(null);
  const [roundSummaryEligibilityError, setRoundSummaryEligibilityError] = useState<string | null>(null);
  const [roundSummaryError, setRoundSummaryError] = useState<string | null>(null);
  const [newsMode, setNewsMode] = useState<NewsMode>('team');
  const [newsReactions, setNewsReactions] = useState<Record<string, NewsReaction[]>>({});
  const newsModeStorageKey = getNewsModeStorageKey(tournamentId, myHtUserId);
  const draftStorageKey = getNewsDraftStorageKey(tournamentId, seasonNumber, newsMode, myHtUserId);
  const currentDraftRef = useRef<{ storageKey: string; draft: NewsDraft }>({
    storageKey: draftStorageKey,
    draft: { title: newNewsTitle, content: newNewsContent },
  });
  const reactionAuthorNames = Object.fromEntries(
    teams
      .filter((team) => team.hattrick_user_id)
      .map((team) => [String(team.hattrick_user_id), team.manager_name || team.name]),
  );
  const myTeam = myHtUserId ? teams.find((team) => team.hattrick_user_id === Number(myHtUserId)) : null;
  const cupPressAuthorName = myTeam?.manager_name || myManagerName || myTeam?.name || 'Tournament organizer';
  const cupPressByline = `${OFFICIAL_PRESS_BYLINE} (by ${cupPressAuthorName})`;

  useEffect(
    () => () => {
      if (roundSummaryTimerRef.current !== null) window.clearInterval(roundSummaryTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    currentDraftRef.current = {
      storageKey: draftStorageKey,
      draft: {
        title: newNewsTitle,
        content: newNewsContent,
        roundSummaryRoundNumber: newsMode === 'admin' ? generatedRoundNumber || undefined : undefined,
      },
    };
  }, [draftStorageKey, generatedRoundNumber, newNewsContent, newNewsTitle, newsMode]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const savedMode = readNewsMode(newsModeStorageKey);
      setNewsMode(savedMode === 'admin' && canPublishAnnouncements ? 'admin' : 'team');
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [canPublishAnnouncements, newsModeStorageKey]);

  useEffect(() => {
    const restoreDraft = () => {
      const draft = readNewsDraft(draftStorageKey);
      setNewNewsTitle(draft?.title || '');
      setNewNewsContent(draft?.content || '');
      const savedRoundNumber = newsMode === 'admin' ? draft?.roundSummaryRoundNumber || null : null;
      setGeneratedRoundNumber(savedRoundNumber);
      setHasGeneratedRoundSummary(savedRoundNumber !== null);
    };
    restoreDraft();
  }, [draftStorageKey, newsMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      persistNewsDraft(draftStorageKey, {
        title: newNewsTitle,
        content: newNewsContent,
        roundSummaryRoundNumber: newsMode === 'admin' ? generatedRoundNumber || undefined : undefined,
      });
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [draftStorageKey, generatedRoundNumber, newNewsContent, newNewsTitle, newsMode]);

  useEffect(() => {
    const flushDraft = () => persistNewsDraft(currentDraftRef.current.storageKey, currentDraftRef.current.draft);
    window.addEventListener('pagehide', flushDraft);
    return () => window.removeEventListener('pagehide', flushDraft);
  }, []);

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
          .in(
            'post_id',
            posts.map((post) => post.id),
          );
        setNewsReactions(Object.groupBy((reactionRows as NewsReaction[] | null) || [], (reaction) => reaction.post_id));
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
          const post = payload.new as NewsPost;
          if (post.season_number === seasonNumber) {
            setNewsPosts((current) => prependNewsPost(current, post));
            if (post.is_round_report) setRoundSummaryEligibility(null);
          }
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news_reactions' }, (payload) => {
        const reaction = payload.new as NewsReaction;
        if (!reaction.post_id) return;
        setNewsReactions((current) => {
          const existing = current[reaction.post_id] || [];
          return {
            ...current,
            [reaction.post_id]: [...existing.filter((item) => item.user_id !== reaction.user_id), reaction],
          };
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isActive, seasonNumber, tournamentId]);

  useEffect(() => {
    if (!isActive || !canPublishAnnouncements) return;

    let cancelled = false;
    const checkEligibility = async () => {
      try {
        const response = await fetch(
          `/api/app?route=generate-round-summary&tournamentId=${encodeURIComponent(tournamentId)}`,
          { credentials: 'include' },
        );
        if (!response.ok) {
          if (!cancelled) {
            setRoundSummaryEligibility(null);
            setRoundSummaryEligibilityError('Could not check round-summary availability. Please reload and try again.');
          }
          return;
        }
        const result = (await response.json()) as { available?: boolean; roundNumber?: number };
        if (!cancelled) {
          setRoundSummaryEligibilityError(null);
          setRoundSummaryEligibility(
            result.available && result.roundNumber ? { seasonNumber, roundNumber: result.roundNumber } : null,
          );
        }
      } catch {
        if (!cancelled) {
          setRoundSummaryEligibility(null);
          setRoundSummaryEligibilityError('Could not check round-summary availability. Please reload and try again.');
        }
      }
    };
    void checkEligibility();
    return () => {
      cancelled = true;
    };
  }, [canPublishAnnouncements, isActive, seasonNumber, tournamentId]);

  const handlePostMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newNewsContent.trim()) return;

    setIsPostingNews(true);
    try {
      const isRoundReport = newsMode === 'admin' && hasGeneratedRoundSummary && generatedRoundNumber !== null;
      let createdPost: NewsPost | null = null;
      if (isRoundReport) {
        const response = await fetch('/api/app?route=post-round-summary', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournamentId,
            seasonNumber,
            roundNumber: generatedRoundNumber,
            title: newNewsTitle.trim(),
            content: newNewsContent.trim(),
          }),
        });
        const result = (await response.json()) as NewsPost & { error?: string };
        if (!response.ok) throw new Error(result.error || 'Could not post the round report.');
        createdPost = result;
        if (createdPost.is_round_report) setRoundSummaryEligibility(null);
      } else {
        const { data, error } = await supabase
          .from('news_posts')
          .insert({
            tournament_id: tournamentId,
            season_number: seasonNumber,
            title: newNewsTitle.trim(),
            content: newNewsContent.trim(),
            author_name: newsMode === 'admin' ? cupPressByline : myTeam?.name || 'Guest',
            author_team_id: newsMode === 'admin' ? null : myTeam?.id || null,
            is_admin: newsMode === 'admin',
          })
          .select('*')
          .single();
        if (error) throw error;
        createdPost = data as NewsPost;
      }

      if (createdPost) setNewsPosts((current) => prependNewsPost(current, createdPost));
      persistNewsDraft(draftStorageKey, { title: '', content: '' });
      currentDraftRef.current = { storageKey: draftStorageKey, draft: { title: '', content: '' } };
      setNewNewsContent('');
      setNewNewsTitle('');
      setHasGeneratedRoundSummary(false);
      setGeneratedRoundNumber(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not post news.');
    } finally {
      setIsPostingNews(false);
    }
  };

  const handleNewsModeChange = (mode: NewsMode) => {
    if (mode === newsMode) return;
    persistNewsDraft(draftStorageKey, { title: newNewsTitle, content: newNewsContent });
    persistNewsMode(newsModeStorageKey, mode);
    setNewsMode(mode);
  };

  const handleNewsTitleChange = (title: string) => {
    currentDraftRef.current = {
      storageKey: draftStorageKey,
      draft: {
        title,
        content: newNewsContent,
        roundSummaryRoundNumber: newsMode === 'admin' ? generatedRoundNumber || undefined : undefined,
      },
    };
    setNewNewsTitle(title);
  };

  const handleNewsContentChange = (content: string) => {
    currentDraftRef.current = {
      storageKey: draftStorageKey,
      draft: {
        title: newNewsTitle,
        content,
        roundSummaryRoundNumber: newsMode === 'admin' ? generatedRoundNumber || undefined : undefined,
      },
    };
    if (content === '') setHasGeneratedRoundSummary(false);
    if (content === '') setGeneratedRoundNumber(null);
    if (content === '') setRoundSummaryPromptRevision(null);
    setNewNewsContent(content);
  };

  const handleClearRoundSummary = () => {
    currentDraftRef.current = { storageKey: draftStorageKey, draft: { title: '', content: '' } };
    persistNewsDraft(draftStorageKey, { title: '', content: '' });
    setNewNewsTitle('');
    setNewNewsContent('');
    setHasGeneratedRoundSummary(false);
    setGeneratedRoundNumber(null);
    setRoundSummaryPromptRevision(null);
  };

  const handleCreateRoundSummary = async () => {
    const roundSummaryRoundNumber =
      roundSummaryEligibility?.seasonNumber === seasonNumber ? roundSummaryEligibility.roundNumber : null;
    if (!roundSummaryRoundNumber || isCreatingRoundSummary || newsMode !== 'admin') return;
    setIsCreatingRoundSummary(true);
    setRoundSummaryElapsedSeconds(0);
    setRoundSummaryError(null);
    setRoundSummaryPromptRevision(null);
    const startedAt = Date.now();
    roundSummaryTimerRef.current = window.setInterval(() => {
      setRoundSummaryElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    try {
      const response = await fetch('/api/app?route=generate-round-summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId,
          seasonNumber,
          roundNumber: roundSummaryRoundNumber,
        }),
      });
      const result = (await response.json()) as {
        title?: string;
        intro?: string;
        matches?: Array<{ paragraph?: string }>;
        outro?: string;
        promptRevision?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || 'Could not create the round summary.');
      const title = result.title || '';
      const content = [result.intro, ...(result.matches || []).map((match) => match.paragraph), result.outro]
        .filter(Boolean)
        .join('\n\n');
      currentDraftRef.current = {
        storageKey: draftStorageKey,
        draft: { title, content, roundSummaryRoundNumber: roundSummaryRoundNumber },
      };
      setNewNewsTitle(title);
      setNewNewsContent(content);
      setHasGeneratedRoundSummary(true);
      setGeneratedRoundNumber(roundSummaryRoundNumber);
      setRoundSummaryPromptRevision(result.promptRevision || null);
    } catch (error) {
      setRoundSummaryError(error instanceof Error ? error.message : 'Could not create the round summary.');
    } finally {
      if (roundSummaryTimerRef.current !== null) {
        window.clearInterval(roundSummaryTimerRef.current);
        roundSummaryTimerRef.current = null;
      }
      setIsCreatingRoundSummary(false);
    }
  };

  const handleAddReaction = async (postId: string, reaction: string) => {
    const userId = localStorage.getItem('my_ht_user_id');
    if (!userId) return;
    const { error } = await supabase
      .from('news_reactions')
      .upsert({ post_id: postId, user_id: userId, reaction }, { onConflict: 'post_id,user_id' });
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
      <NoticeDialog message={notice} onClose={closeNotice} />
      <div className={styles.guestbook}>
        <div className={styles.weeklyPanels}>
          {newsPosts.length === 0 && (
            <SectionCard title="🗞 120min Weekly" className={styles.weeklyPanel}>
              <p className={styles.noPosts}>No news yet.</p>
            </SectionCard>
          )}
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
                tournamentImageUrl={tournamentImageUrl}
                visitHref={window.location.pathname}
              />
            </SectionCard>
          )}

          {olderPosts.map((post) => {
            const authorTeam = post.author_team_id ? teams.find((team) => team.id === post.author_team_id) : null;

            return (
              <SectionCard key={post.id} title="🗞 120min Weekly" className={styles.weeklyPanel}>
                <NewsArticle
                  post={post}
                  authorTeam={authorTeam}
                  reactions={newsReactions[post.id]}
                  currentUserId={myHtUserId}
                  reactionAuthorNames={reactionAuthorNames}
                  onReaction={handleAddReaction}
                  tournamentImageUrl={tournamentImageUrl}
                  visitHref={window.location.pathname}
                />
              </SectionCard>
            );
          })}

          <SectionCard title="Write a press release">
            <div className={styles.newsTabs}>
              <button className={newsMode === 'team' ? styles.active : ''} onClick={() => handleNewsModeChange('team')}>
                Team News
              </button>
              {isAdminAuthenticated && canPublishAnnouncements && (
                <button
                  className={newsMode === 'admin' ? styles.active : ''}
                  onClick={() => handleNewsModeChange('admin')}
                >
                  Official Tournament Update
                </button>
              )}
            </div>

            <div className={styles.postingTeamBranding}>
              {(() => {
                if (newsMode === 'admin') {
                  return (
                    <div className={styles.branding}>
                      <span>
                        📰 Posting as: <strong>{cupPressByline}</strong>
                      </span>
                    </div>
                  );
                }

                return myTeam ? (
                  <div className={styles.branding}>
                    <span>
                      📰 Posting as: <strong>{myTeam.name}</strong>
                    </span>
                  </div>
                ) : (
                  <p>You don't have a team in this tournament.</p>
                );
              })()}
            </div>

            <form onSubmit={handlePostMessage} className={styles.postForm}>
              <div className={styles.newsInputGroup}>
                <input
                  type="text"
                  value={newNewsTitle}
                  onChange={(event) => handleNewsTitleChange(event.target.value)}
                  placeholder="Title, e.g., Round 3 Objectives"
                  className={styles.postTitleInput}
                />
                <textarea
                  value={newNewsContent}
                  onChange={(event) => handleNewsContentChange(event.target.value)}
                  placeholder={newsMode === 'admin' ? 'Write a tournament announcement...' : 'How is your team doing?'}
                  className={styles.postTextarea}
                  rows={16}
                />
              </div>
              {roundSummaryError && newsMode === 'admin' && (
                <p className={styles.roundSummaryError} role="alert">
                  {roundSummaryError}
                </p>
              )}
              {isCreatingRoundSummary && newsMode === 'admin' && (
                <p className={styles.roundSummaryStatus} role="status">
                  {roundSummaryElapsedSeconds > 65
                    ? 'Generating. Takes about a minute. Or more...'
                    : 'Generating. Takes about a minute...'}{' '}
                  {String(Math.floor(roundSummaryElapsedSeconds / 60)).padStart(2, '0')}:
                  {String(roundSummaryElapsedSeconds % 60).padStart(2, '0')}
                </p>
              )}
              {roundSummaryPromptRevision && newsMode === 'admin' && (
                <p className={styles.roundSummaryStatus}>Debug: prompt revision {roundSummaryPromptRevision}</p>
              )}
              {roundSummaryEligibilityError && newsMode === 'admin' && (
                <p className={styles.roundSummaryError} role="alert">
                  {roundSummaryEligibilityError}
                </p>
              )}
              <div className={styles.postActions}>
                {newsMode === 'admin' &&
                  canPublishAnnouncements &&
                  roundSummaryEligibility?.seasonNumber === seasonNumber &&
                  (hasGeneratedRoundSummary ? (
                    <Button type="button" variant="secondaryAction" onClick={handleClearRoundSummary}>
                      Clear report
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      disabled={isCreatingRoundSummary}
                      onClick={() => void handleCreateRoundSummary()}
                    >
                      {isCreatingRoundSummary
                        ? 'Creating summary…'
                        : `Generate round ${roundSummaryEligibility.roundNumber} report`}
                    </Button>
                  ))}
                <Button type="submit" variant="primary" disabled={isPostingNews || !newNewsContent.trim()}>
                  {isPostingNews ? 'Posting...' : 'Post Announcement'}
                </Button>
              </div>
            </form>
          </SectionCard>
        </div>
      </div>

      <aside className={styles.newsSidebar}>
        <CompactAccordionWidget title="Tournament FAQ" icon={<Question size={20} weight="bold" />} items={faqItems} />
      </aside>
    </div>
  );
};
