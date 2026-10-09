import React, { useState, useRef, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tooltip } from '../Tooltip/Tooltip';
import chatStyles from './ChatView.module.sass';
import sharedStyles from '../../legacy-pages/Public/TournamentView.module.sass';
import { Button } from '../Button/Button';
import { Avatar } from '../Avatar/Avatar';
import { ArrowRight, PaperPlaneTilt, User } from 'phosphor-react';
import { useClientNow, useHydrationReady } from '../../hooks/useHydratedBrowserState';
import { getCanonicalCountryName, getCountryFlagUrl } from '../../utils/ht-data';
import {
  buildTournamentEmojiOptions,
  TOURNAMENT_EMOJI_OPTIONS,
  type TournamentEmojiContext,
} from '../../utils/tournament-emoji-options';
import { DEFAULT_TOURNAMENT_CHAT_WELCOME, withChatWelcome } from '../../utils/chat-welcome';

export interface ChatMessage {
  id: string;
  author_name: string;
  content: string;
  created_at: string;
  author_ht_id: number;
  global_message?: boolean;
  is_published?: boolean;
  profiles?: ChatAuthorProfile | null;
}

export interface ChatAuthorProfile {
  avatar_json: React.ComponentProps<typeof Avatar>['avatar'];
  country_name?: string | null;
  country_id?: number | null;
}

interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (content: string, globalMessage?: boolean) => void;
  myHtUserId: number | null;
  leagueManagerIds?: number[];
  teamNames?: Record<number, string>;
  teamDetails?: Record<number, { name: string; countryName?: string | null; countryId?: number | null }>;
  tournamentEmojiContext?: TournamentEmojiContext;
  showGuestTeam?: boolean;
  markUnknownAuthorsExternal?: boolean;
  maxMessageLength?: number;
  welcomeMessage?: string;
  allowGlobalMessageControl?: boolean;
}

export interface AuthorTooltipProps {
  id: string;
  authorName: string;
  teamName?: string | null;
  countryName?: string | null;
  countryId?: number | null;
  managerCountryName?: string | null;
  managerCountryId?: number | null;
  avatar?: React.ComponentProps<typeof Avatar>['avatar'];
}

const OFFICIAL_HT_USER_ID = 8777402;

export const AuthorTooltip = ({
  id,
  authorName,
  teamName,
  countryName: rawCountryName,
  countryId,
  managerCountryName: rawManagerCountryName,
  managerCountryId,
  avatar,
}: AuthorTooltipProps) => {
  const countryName = getCanonicalCountryName(rawCountryName, countryId);
  const flagUrl = getCountryFlagUrl(countryId, countryName);
  const managerCountryName = getCanonicalCountryName(rawManagerCountryName, managerCountryId);
  const managerFlagUrl = getCountryFlagUrl(managerCountryId, managerCountryName);

  return (
    <Tooltip id={id} className={chatStyles.chatAuthorTooltip}>
      {avatar && (
        <div className={chatStyles.tooltipAvatar}>
          <Avatar className={chatStyles.tooltipAvatarImg} avatar={avatar} variant="rect" size={50} />
        </div>
      )}
      <div className={chatStyles.tooltipDetails}>
        <strong className={chatStyles.tooltipManagerName}>
          {authorName}
          {managerFlagUrl && <img src={managerFlagUrl} alt="" className={chatStyles.tooltipManagerFlag} />}
        </strong>
        {teamName && <span className={chatStyles.tooltipTeamName}>{teamName}</span>}
        {countryName && (
          <span className={chatStyles.tooltipCountry}>
            {flagUrl && <img src={flagUrl} alt="" />}
            {countryName}
          </span>
        )}
      </div>
    </Tooltip>
  );
};

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

const formatChatTimestamp = (createdAt: string, nowMs: number) => {
  const created = new Date(createdAt).getTime();
  const ageMs = nowMs - created;
  const dayMs = 24 * 60 * 60 * 1000;

  if (!Number.isFinite(created) || ageMs < dayMs) {
    return new Date(createdAt).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Riga',
    });
  }

  const days = Math.floor(ageMs / dayMs);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;

  return `${Math.floor(days / 365)}y`;
};

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  onSendMessage,
  myHtUserId,
  leagueManagerIds = [],
  teamNames = {},
  teamDetails = {},
  tournamentEmojiContext,
  showGuestTeam = true,
  markUnknownAuthorsExternal = true,
  maxMessageLength,
  welcomeMessage = DEFAULT_TOURNAMENT_CHAT_WELCOME,
  allowGlobalMessageControl = false,
}) => {
  const t = useTranslations('Home');
  const [newChatContent, setNewChatContent] = useState('');
  const [globalMessage, setGlobalMessage] = useState(false);
  const isHydrationReady = useHydrationReady();
  const isLocalhost = isHydrationReady && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
  const pathname = usePathname() || '/';
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(20);
  const nowMs = useClientNow(30_000);
  const emojiOptions = buildTournamentEmojiOptions(TOURNAMENT_EMOJI_OPTIONS, tournamentEmojiContext);
  const displayMessages = withChatWelcome(messages, welcomeMessage);
  const visibleMessages = displayMessages.slice(-visibleMessageCount);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, visibleMessageCount]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatContent.trim()) return;
    onSendMessage(newChatContent, globalMessage);
    setNewChatContent('');
    setGlobalMessage(false);
  };

  const handleOpenProfile = (htId: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('profileId', htId.toString());
    router.push(`${pathname}?${nextParams.toString()}`);
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
    <>
      <div className={chatStyles.chatSection}>
        <div className={chatStyles.chatMessages} ref={chatContainerRef}>
          {displayMessages.length > visibleMessageCount && (
            <button className={chatStyles.loadMoreBtn} onClick={() => setVisibleMessageCount((prev) => prev + 20)}>
              {t('chatLoadMore')}
            </button>
          )}
          {visibleMessages.map((msg, index) => {
            const isOwnMessage = msg.author_ht_id === myHtUserId;
            const isLeagueManager = leagueManagerIds.includes(msg.author_ht_id);
            const isSystem = msg.author_ht_id === 0;
            const isBigEmoji = isBigEmojiMessage(msg.content);
            const isExternalManager = markUnknownAuthorsExternal && !isLeagueManager && !isOwnMessage;
            const timestamp = formatChatTimestamp(msg.created_at, nowMs);
            const previousMessage = visibleMessages[index - 1];
            const continuesPrevious =
              !isSystem &&
              previousMessage !== undefined &&
              previousMessage.author_ht_id === msg.author_ht_id &&
              previousMessage.author_name === msg.author_name &&
              formatChatTimestamp(previousMessage.created_at, nowMs) === timestamp;
            const authorCountryName = getCanonicalCountryName(msg.profiles?.country_name, msg.profiles?.country_id);
            const authorFlagUrl = getCountryFlagUrl(msg.profiles?.country_id, authorCountryName);

            if (isSystem) {
              return (
                <div key={msg.id} className={chatStyles.systemMessage}>
                  <div className={chatStyles.systemMessageContent}>
                    <span className={chatStyles.chatContent}>{msg.content}</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`${chatStyles.chatMessage} ${isOwnMessage ? chatStyles.ownMessage : chatStyles.otherMessage} ${isExternalManager ? chatStyles.externalManager : ''} ${continuesPrevious ? chatStyles.groupedMessage : ''}`}
              >
                <div className={chatStyles.chatMessageContent}>
                  {!continuesPrevious && <span className={chatStyles.chatTime}>{timestamp}</span>}
                  {!isOwnMessage && !continuesPrevious && (
                    <>
                      <button
                        onClick={() => handleOpenProfile(msg.author_ht_id)}
                        className={chatStyles.chatAuthor}
                        data-tooltip-id={`author-tooltip-${msg.id}`}
                      >
                        {msg.profiles?.avatar_json && (
                          <Avatar avatar={msg.profiles.avatar_json} variant="rect" size={22} />
                        )}
                        <span>{msg.author_name}</span>
                        {authorFlagUrl && (
                          <img
                            src={authorFlagUrl}
                            alt={authorCountryName || t('chatCountryFlag')}
                            className={chatStyles.chatAuthorFlag}
                          />
                        )}
                      </button>
                      <AuthorTooltip
                        id={`author-tooltip-${msg.id}`}
                        authorName={msg.author_name}
                        teamName={
                          msg.author_ht_id === OFFICIAL_HT_USER_ID
                            ? t('chatCreator')
                            : teamDetails[msg.author_ht_id]?.name ||
                              teamNames[msg.author_ht_id] ||
                              (showGuestTeam ? t('chatGuest') : undefined)
                        }
                        countryName={teamDetails[msg.author_ht_id]?.countryName}
                        countryId={teamDetails[msg.author_ht_id]?.countryId}
                        managerCountryName={msg.profiles?.country_name}
                        managerCountryId={msg.profiles?.country_id}
                        avatar={msg.profiles?.avatar_json || null}
                      />
                    </>
                  )}
                  <div
                    className={`${chatStyles.chatBubble} ${isBigEmoji ? chatStyles.bigEmojiBubble : ''} ${msg.global_message ? chatStyles.globalMessage : ''}`}
                  >
                    <span className={`${chatStyles.chatContent} ${isBigEmoji ? chatStyles.bigEmoji : ''}`}>{msg.content}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {myHtUserId ? (
          <form onSubmit={handleSubmit} className={chatStyles.chatInputArea}>
            <div className={chatStyles.chatInputRow}>
              <input
                ref={chatInputRef}
                type="text"
                value={newChatContent}
                onChange={(e) => setNewChatContent(e.target.value)}
                placeholder={t('chatPlaceholder')}
                maxLength={maxMessageLength}
                className={sharedStyles.postTextarea}
              />
              <button type="submit" className={chatStyles.sendBtn} aria-label={t('chatSend')}>
                <PaperPlaneTilt size={22} weight="bold" />
              </button>
            </div>
            <div className={chatStyles.chatEmojiBar} aria-label={t('chatEmojiPicker')}>
              {emojiOptions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={chatStyles.chatEmojiBtn}
                  onClick={() => handleEmojiClick(emoji)}
                  aria-label={t('chatAddEmoji', { emoji })}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {allowGlobalMessageControl && isLocalhost && myHtUserId === 8777402 && (
              <label className={chatStyles.globalMessageToggle}>
                <input
                  type="checkbox"
                  checked={globalMessage}
                  onChange={(event) => setGlobalMessage(event.target.checked)}
                />
                {t('chatGlobalMessageToggle')}
              </label>
            )}
          </form>
        ) : (
          <div className={chatStyles.loginToPost}>
            <Button size="sm" onClick={handleLogin} variant="primary" className={chatStyles.chatLoginBtn} type="button">
              <User size={18} weight="bold" />
              <span>{t('chatLogin')}</span>
              <ArrowRight size={18} className="hideOnTable" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
};
