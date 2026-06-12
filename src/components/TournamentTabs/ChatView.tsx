import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from '../../pages/Public/TournamentView.module.sass';
import { Avatar } from '../Avatar/Avatar';
import { PaperPlaneTilt } from 'phosphor-react';

interface ChatMessage {
  id: string;
  author_name: string;
  content: string;
  created_at: string;
  author_ht_id: number;
  profiles?: {
    avatar_json: unknown;
  };
}

interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  myHtUserId: number | null;
  leagueManagerIds: number[];
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  onSendMessage,
  myHtUserId,
  leagueManagerIds,
}) => {
  const [newChatContent, setNewChatContent] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatContent.trim()) return;
    onSendMessage(newChatContent);
    setNewChatContent('');
  };

  const handleOpenProfile = (htId: number) => {
    setSearchParams({ ...Object.fromEntries(searchParams.entries()), profileId: htId.toString() });
  };

  return (
    <div className={styles.chatSection}>
      <div className={styles.chatMessages} ref={chatContainerRef}>
        {messages.map((msg) => {
          const isOwnMessage = msg.author_ht_id === myHtUserId;
          const isLeagueManager = leagueManagerIds.includes(msg.author_ht_id);
          
          return (
            <div
              key={msg.id}
              className={`${styles.chatMessage} ${isOwnMessage ? styles.ownMessage : styles.otherMessage} ${!isLeagueManager && !isOwnMessage ? styles.externalManager : ''}`}
            >
              <div className={styles.chatAvatarWrapper}>
                <Avatar
                  backgroundImage={msg.profiles?.avatar_json?.backgroundImage}
                  layers={msg.profiles?.avatar_json?.layers}
                  className={styles.chatAvatar}
                />
              </div>

              <div className={styles.chatMessageContent}>
                <button
                  onClick={() => handleOpenProfile(msg.author_ht_id)}
                  className={styles.chatAuthor}
                >
                  {msg.author_name}
                </button>
                <div className={styles.chatBubble}>
                  <span className={styles.chatContent}>{msg.content}</span>
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
          <input
            type="text"
            value={newChatContent}
            onChange={(e) => setNewChatContent(e.target.value)}
            placeholder="Say something..."
            className={styles.postTextarea}
          />
          <button type="submit" className={styles.sendBtn}>
            <PaperPlaneTilt size={22} weight="bold" />
          </button>
        </form>
      ) : (
        <div className={styles.loginToPost}>
          <p>Login to say something...</p>
        </div>
      )}
    </div>
  );
};
