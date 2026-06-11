import React, { useState, useRef, useEffect } from 'react';
import styles from '../TournamentView.module.sass';

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
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatContent.trim()) return;
    onSendMessage(newChatContent);
    setNewChatContent('');
  };

  return (
    <div className={styles.chatSection}>
      <div className={styles.chatMessages}>
        {messages.map((msg) => {
          const isOwnMessage = msg.author_ht_id === myHtUserId;
          return (
            <div key={msg.id} className={`${styles.chatMessage} ${isOwnMessage ? styles.ownMessage : ''}`}>
              {!isOwnMessage && (
                <a href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/Default.aspx?userId=${msg.author_ht_id}`} target="_blank" className={styles.chatAuthor}>
                  {msg.author_name}
                </a>
              )}
              <div className={styles.chatBubble}>
                <span className={styles.chatContent}>{msg.content}</span>
              </div>
              <span className={styles.chatTime}>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>
      <form onSubmit={handleSubmit} className={styles.chatInputArea}>
        <input
          type="text"
          value={newChatContent}
          onChange={(e) => setNewChatContent(e.target.value)}
          placeholder="Type a message..."
          className={styles.postTextarea}
        />
        <button type="submit" className={styles.sendBtn}>Send</button>
      </form>
    </div>
  );
};
