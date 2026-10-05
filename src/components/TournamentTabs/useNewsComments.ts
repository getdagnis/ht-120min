'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Avatar } from '../Avatar/Avatar';
import { supabase } from '../../lib/supabase';

export type NewsCommentAvatar = React.ComponentProps<typeof Avatar>['avatar'];

export interface NewsComment {
  id: string;
  post_id: string;
  hattrick_user_id: number;
  author_name: string;
  content: string;
  created_at: string;
  avatar_json?: NewsCommentAvatar;
}

export interface NewsCommentAuthor {
  managerId: number;
  managerName: string;
  avatar: NewsCommentAvatar;
}

interface NewsCommentsResponse {
  comments?: NewsComment[];
  viewer?: {
    manager_name?: string | null;
    avatar_json?: NewsCommentAvatar;
  } | null;
  error?: string;
}

const mergeComment = (comments: NewsComment[], next: NewsComment) => [
  ...comments.filter((comment) => comment.id !== next.id),
  next,
].sort((left, right) => left.created_at.localeCompare(right.created_at));

const groupComments = (comments: NewsComment[]) => {
  const grouped: Record<string, NewsComment[]> = {};
  for (const comment of comments) {
    grouped[comment.post_id] = mergeComment(grouped[comment.post_id] || [], comment);
  }
  return grouped;
};

export function useNewsComments(
  postIds: string[],
  currentUserId: string | null,
  currentManagerName: string | null,
  enabled = true,
) {
  const channelInstanceId = useId().replaceAll(':', '');
  const channelGenerationRef = useRef(0);
  const postKey = useMemo(() => postIds.join('|'), [postIds]);
  const viewerId = Number(currentUserId) || null;
  const [commentsByPost, setCommentsByPost] = useState<Record<string, NewsComment[]>>({});
  const [viewerAvatar, setViewerAvatar] = useState<NewsCommentAvatar>(null);
  const [viewerName, setViewerName] = useState<string | null>(currentManagerName);
  const [submittingPostId, setSubmittingPostId] = useState<string | null>(null);

  useEffect(() => {
    const ids = postKey ? postKey.split('|').filter(Boolean) : [];
    if (!enabled || ids.length === 0) return;

    let cancelled = false;
    const query = new URLSearchParams({
      postIds: ids.join(','),
    });
    if (viewerId) query.set('viewerId', String(viewerId));

    const loadComments = async () => {
      try {
        const response = await fetch(`/api/app?route=news-comments&${query.toString()}`, {
          credentials: 'include',
        });
        const result = (await response.json()) as NewsCommentsResponse;
        if (!response.ok) throw new Error(result.error || 'Could not load article comments.');
        if (cancelled) return;
        setCommentsByPost(groupComments(result.comments || []));
        setViewerAvatar(result.viewer?.avatar_json || null);
        setViewerName(currentManagerName || result.viewer?.manager_name || null);
      } catch {
        if (!cancelled) {
          setCommentsByPost({});
          setViewerAvatar(null);
          setViewerName(currentManagerName);
        }
      }
    };
    void loadComments();

    const postIdSet = new Set(ids);
    // Supabase reuses channel topics while an async cleanup is pending. Give
    // each hook effect a unique topic so News/Standings transitions cannot
    // attach callbacks to an already-subscribed channel.
    const channelGeneration = ++channelGenerationRef.current;
    const channel = supabase
      .channel(`news-comments:${channelInstanceId}:${channelGeneration}:${postKey}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'news_comments' },
        async (payload) => {
          const incoming = payload.new as NewsComment;
          if (!incoming.post_id || !postIdSet.has(incoming.post_id)) return;
          const { data: profile } = await supabase
            .from('profiles')
            .select('avatar_json')
            .eq('hattrick_user_id', incoming.hattrick_user_id)
            .maybeSingle();
          if (cancelled) return;
          const hydrated = { ...incoming, avatar_json: profile?.avatar_json || null };
          setCommentsByPost((current) => ({
            ...current,
            [incoming.post_id]: mergeComment(current[incoming.post_id] || [], hydrated),
          }));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [channelInstanceId, currentManagerName, enabled, postKey, viewerId]);

  const submitComment = async (postId: string, content: string) => {
    if (!viewerId || !content.trim()) return;
    setSubmittingPostId(postId);
    try {
      const response = await fetch('/api/app?route=news-comments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, content }),
      });
      const result = (await response.json()) as NewsCommentsResponse & { comment?: NewsComment };
      if (!response.ok || !result.comment) throw new Error(result.error || 'Could not post comment.');
      setCommentsByPost((current) => ({
        ...current,
        [postId]: mergeComment(current[postId] || [], result.comment as NewsComment),
      }));
    } finally {
      setSubmittingPostId(null);
    }
  };

  return {
    commentsByPost,
    currentAuthor: viewerId && viewerName ? { managerId: viewerId, managerName: viewerName, avatar: viewerAvatar } : null,
    submitComment,
    submittingPostId,
  };
}
