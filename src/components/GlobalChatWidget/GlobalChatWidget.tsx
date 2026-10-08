'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChatText } from 'phosphor-react';
import { useTranslations } from 'next-intl';
import { supabase } from '../../lib/supabase';
import { GLOBAL_CHAT_MAX_LENGTH } from '../../utils/global-chat';
import { NoticeDialog } from '../Modal/NoticeDialog';
import { useNoticeDialog } from '../Modal/useNoticeDialog';
import { ChatView, type ChatMessage } from '../TournamentTabs/ChatView';
import styles from './GlobalChatWidget.module.sass';

interface GlobalChatWidgetProps {
  myHtUserId: number | null;
}

type ProfileAvatar = NonNullable<ChatMessage['profiles']>;

const sortMessages = (messages: ChatMessage[]) =>
  [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

export const GlobalChatWidget: React.FC<GlobalChatWidgetProps> = ({ myHtUserId }) => {
  const t = useTranslations('Home');
  const welcomeMessage = t('chatWelcome');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { notice, showNotice, closeNotice } = useNoticeDialog();

  const addMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      incoming.forEach((message) => byId.set(message.id, message));
      return sortMessages(Array.from(byId.values()));
    });
  }, []);

  const loadProfiles = useCallback(async (chatMessages: ChatMessage[]) => {
    const authorIds = [...new Set(chatMessages.map((message) => message.author_ht_id).filter((id) => id > 0))];
    if (authorIds.length === 0) return chatMessages;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('hattrick_user_id, avatar_json, country_name, country_id')
      .in('hattrick_user_id', authorIds);
    const profileMap = new Map<number, ProfileAvatar>(
      (profiles || []).map((profile) => [
        profile.hattrick_user_id,
        {
          avatar_json: profile.avatar_json,
          country_name: profile.country_name,
          country_id: profile.country_id,
        },
      ]),
    );

    return chatMessages.map((message) => ({
      ...message,
      profiles: profileMap.get(message.author_ht_id) || null,
    }));
  }, []);

  const loadMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('global_chat')
      .select('id, author_name, author_ht_id, content, created_at, global_message')
      .order('created_at', { ascending: true });
    if (error || !data) return;

    addMessages(await loadProfiles(data as ChatMessage[]));
  }, [addMessages, loadProfiles]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadMessages();
    }, 0);

    const channel = supabase
      .channel('global-chat')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'global_chat' },
        async (payload) => {
          const newMessage = payload.new as ChatMessage;
          if (!newMessage?.id) return;
          addMessages(await loadProfiles([newMessage]));
        },
      )
      .subscribe();

    return () => {
      window.clearTimeout(initialLoad);
      supabase.removeChannel(channel);
    };
  }, [addMessages, loadMessages, loadProfiles]);

  const handleSendMessage = async (content: string) => {
    try {
      const response = await fetch('/api/app?route=global-chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const result = (await response.json().catch(() => null)) as (ChatMessage & { error?: string }) | null;
      if (!response.ok || !result || result.error) {
        throw new Error(result?.error || t('chatSendError'));
      }

      addMessages(await loadProfiles([result]));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('chatSendError'));
    }
  };

  return (
    <>
      <section className={styles.widget} aria-labelledby="global-chat-title">
        <h2 id="global-chat-title" className={styles.header}>
          <ChatText size={20} weight="bold" aria-hidden="true" />
          <span>{t('chatTitle')}</span>
        </h2>
        <ChatView
          messages={messages}
          onSendMessage={handleSendMessage}
          myHtUserId={myHtUserId}
          showGuestTeam={false}
          markUnknownAuthorsExternal={false}
          maxMessageLength={GLOBAL_CHAT_MAX_LENGTH}
          welcomeMessage={welcomeMessage}
        />
      </section>
      <NoticeDialog message={notice} onClose={closeNotice} />
    </>
  );
};
