import React, { useState, useRef, useEffect } from 'react';
import styles from '../../pages/Public/TournamentView.module.sass';

interface ChatMessage {
  id: string;
  author_name: string;
  content: string;
  created_at: string;
  author_ht_id: number;
}

interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  myHtUserId: number | null;
}

export const ChatView: React.FC<ChatViewProps> = ({ messages, onSendMessage, myHtUserId }) => {
  const [newChatContent, setNewChatContent] = useState('');
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

  return (
    <div className={styles.chatSection}>
      <div className={styles.chatMessages} ref={chatContainerRef}>
        {messages.map((msg) => {
          const isOwnMessage = msg.author_ht_id === myHtUserId;
          return (
            <div key={msg.id} className={`${styles.chatMessage} ${isOwnMessage ? styles.ownMessage : ''}`}>
              {!isOwnMessage && (
                <a
                  href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/Default.aspx?userId=${msg.author_ht_id}`}
                  target="_blank"
                  className={styles.chatAuthor}
                >
                  {msg.author_name}
                </a>
              )}
              <div className={styles.chatBubble}>
                <span className={styles.chatContent}>{msg.content}</span>
              </div>
              <span className={styles.chatTime}>
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
      </div>
      <form onSubmit={handleSubmit} className={styles.chatInputArea}>
        <input
          type="text"
          value={newChatContent}
          onChange={(e) => setNewChatContent(e.target.value)}
          placeholder="Say something..."
          className={styles.postTextarea}
        />
        <button type="submit" className={styles.sendBtn}>
          Send
        </button>
      </form>
    </div>
  );
};
