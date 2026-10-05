'use client';

import React, { useState } from 'react';
import { Avatar } from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import styles from './NewsTab.module.sass';
import type { NewsComment, NewsCommentAuthor } from './useNewsComments';

interface NewsCommentsProps {
  comments: NewsComment[];
  currentAuthor: NewsCommentAuthor | null;
  managerTeamNames?: Record<number, string>;
  onSubmit: (content: string) => Promise<void>;
  isSubmitting: boolean;
}


const formatCommentTime = (createdAt: string) =>
  new Date(createdAt).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Riga',
  });

export const NewsComments: React.FC<NewsCommentsProps> = ({
  comments,
  currentAuthor,
  managerTeamNames = {},
  onSubmit,
  isSubmitting,
}) => {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!currentAuthor && comments.length === 0) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || isSubmitting) return;
    setError(null);
    try {
      await onSubmit(draft);
      setDraft('');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not post comment.');
    }
  };

  return (
    <section className={styles.newsComments} aria-label="Article comments">
      {currentAuthor && (
        <form className={styles.commentComposer} onSubmit={handleSubmit}>
          <div className={styles.commentAuthor}>
            <Avatar avatar={currentAuthor.avatar} variant="circle" size={36} className={styles.commentAvatar} />
            <div className={styles.commentIdentity}>
              <strong>{currentAuthor.managerName}</strong>
              {managerTeamNames[currentAuthor.managerId] && (
                <span className={styles.commentTeamName}>{managerTeamNames[currentAuthor.managerId]}</span>
              )}
            </div>
          </div>
          <textarea
            value={draft}
            maxLength={480}
            rows={3}
            placeholder="Write a comment..."
            aria-label="Write a comment"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={styles.commentComposerActions}>
            <Button type="submit" size="sm" disabled={!draft.trim() || isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send'}
            </Button>
          </div>
          {error && <p className={styles.commentError} role="alert">{error}</p>}
        </form>
      )}
      {comments.length > 0 && (
        <div className={styles.commentList}>
          {comments.map((comment) => (
            <article key={comment.id} className={styles.commentItem}>
              <Avatar avatar={comment.avatar_json || null} variant="circle" size={36} className={styles.commentAvatar} />
              <div className={styles.commentBody}>
                <div className={styles.commentMeta}>
                  <div className={styles.commentIdentity}>
                    <strong>{comment.author_name}</strong>
                    {managerTeamNames[comment.hattrick_user_id] && (
                      <span className={styles.commentTeamName}>{managerTeamNames[comment.hattrick_user_id]}</span>
                    )}
                  </div>
                  <time dateTime={comment.created_at}>{formatCommentTime(comment.created_at)}</time>
                </div>
                <p>{comment.content}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
