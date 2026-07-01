import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tooltip } from 'react-tooltip';
import styles from '../../pages/Public/TournamentView.module.sass';
import { Button } from '../Button/Button';
import { Avatar } from '../Avatar/Avatar';
import { ArrowRight, PaperPlaneTilt, User } from 'phosphor-react';

interface ChatMessage {
  id: string;
  author_name: string;
  content: string;
  created_at: string;
  author_ht_id: number;
  profiles?: {
    avatar_json: {
      backgroundImage: string;
      layers?: { image: string; x: number; y: number }[];
    } | null;
  };
}

interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  myHtUserId: number | null;
  leagueManagerIds: number[];
  teamNames: Record<number, string>;
}

const isBigEmojiMessage = (content: string): boolean => {
  const trimmed = content.trim();
  if (!trimmed) return false;

  // Use Intl.Segmenter to split the string into actual visual "characters" (graphemes)
  // This correctly handles ZWJ sequences (families) and skin tone modifiers as 1 unit.
  const segments = Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(trimmed));

  // Filter out whitespace
  const nonSpaceSegments = segments.filter((s) => s.segment.trim().length > 0);

  // Check: Must have 1-5 segments, and every segment must be an emoji
  return (
    nonSpaceSegments.length > 0 &&
    nonSpaceSegments.length <= 5 &&
    nonSpaceSegments.every((s) => /\p{Extended_Pictographic}/u.test(s.segment))
  );
};

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  onSendMessage,
  myHtUserId,
  leagueManagerIds,
  teamNames,
}) => {
  const [newChatContent, setNewChatContent] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(20);
  const emojiOptions = ['😀', '😢', '🥶', '💪', '🍻', '🏆', '🎯', '👀', '🧘'];

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, visibleMessageCount]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatContent.trim()) return;
    onSendMessage(newChatContent);
    setNewChatContent('');
  };

  const handleOpenProfile = (htId: number) => {
    setSearchParams({ ...Object.fromEntries(searchParams.entries()), profileId: htId.toString() });
  };

  const handleLogin = () => {
    document.cookie = `auth_return_url=${encodeURIComponent(window.location.pathname + window.location.search)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  };

  const handleEmojiClick = (emoji: string) => {
    const input = chatInputRef.current;
    if (!input) {
      setNewChatContent((prev) => `${prev}${emoji}`);
      return;
    }

    const start = input.selectionStart ?? newChatContent.length;
    const end = input.selectionEnd ?? newChatContent.length;
    const nextValue = `${newChatContent.slice(0, start)}${emoji}${newChatContent.slice(end)}`;

    setNewChatContent(nextValue);

    window.requestAnimationFrame(() => {
      input.focus();
      const nextCursor = start + emoji.length;
      input.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <div className={styles.chatSection}>
      <div className={styles.chatMessages} ref={chatContainerRef}>
        {messages.length > visibleMessageCount && (
          <button className={styles.loadMoreBtn} onClick={() => setVisibleMessageCount((prev) => prev + 20)}>
            Load More
          </button>
        )}
        {messages.slice(-visibleMessageCount).map((msg) => {
          const isOwnMessage = msg.author_ht_id === myHtUserId;
          const isLeagueManager = leagueManagerIds.includes(msg.author_ht_id);
          const isSystem = msg.author_ht_id === 0;
          const isBigEmoji = isBigEmojiMessage(msg.content);

          if (isSystem) {
            return (
              <div key={msg.id} className={styles.systemMessage}>
                <div className={styles.systemMessageContent}>
                  <span className={styles.chatContent}>{msg.content}</span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`${styles.chatMessage} ${isOwnMessage ? styles.ownMessage : styles.otherMessage} ${!isLeagueManager && !isOwnMessage ? styles.externalManager : ''}`}
            >
              <div className={styles.chatMessageContent}>
                {!isOwnMessage && (
                  <>
                    <button
                      onClick={() => handleOpenProfile(msg.author_ht_id)}
                      className={styles.chatAuthor}
                      data-tooltip-id={`author-tooltip-${msg.id}`}
                    >
                      {msg.author_name}
                    </button>
                    <Tooltip id={`author-tooltip-${msg.id}`} className={styles.chatAuthorTooltip}>
                      <div className={styles.tooltipAvatar}>
                        <Avatar
                          className={styles.tooltipAvatarImg}
                          avatar={msg.profiles?.avatar_json || null}
                          variant="circle"
                        />
                      </div>
                      <span className={styles.tooltipTeamName}>{teamNames[msg.author_ht_id] || 'Guest'}</span>
                    </Tooltip>
                  </>
                )}
                <div className={`${styles.chatBubble} ${isBigEmoji ? styles.bigEmojiBubble : ''}`}>
                  <span className={`${styles.chatContent} ${isBigEmoji ? styles.bigEmoji : ''}`}>{msg.content}</span>
                </div>
                <span className={styles.chatTime}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {myHtUserId ? (
        <form onSubmit={handleSubmit} className={styles.chatInputArea}>
          <div className={styles.chatInputRow}>
            <input
              ref={chatInputRef}
              type="text"
              value={newChatContent}
              onChange={(e) => setNewChatContent(e.target.value)}
              placeholder="Say something..."
              className={styles.postTextarea}
            />
            <button type="submit" className={styles.sendBtn}>
              <PaperPlaneTilt size={22} weight="bold" />
            </button>
          </div>
          <div className={styles.chatEmojiBar} aria-label="Quick emoji picker">
            {emojiOptions.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={styles.chatEmojiBtn}
                onClick={() => handleEmojiClick(emoji)}
                aria-label={`Add ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </form>
      ) : (
        <div className={styles.loginToPost}>
          <Button size="sm" onClick={handleLogin} variant="zero" className={styles.chatLoginBtn} type="button">
            <User size={18} weight="bold" />
            <span className={styles.chatLoginLabel}>Login (CHPP)</span> <ArrowRight size={18} className="hideOnTable" />
          </Button>
        </div>
      )}
    </div>
  );
};
