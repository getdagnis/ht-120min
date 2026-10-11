'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShareFatIcon } from '../Icons/ShareFatIcon';
import { getTournamentForumShareCode, getTournamentShareUrl } from '../../utils/tournament-share';
import tabStyles from '../../legacy-pages/Public/TournamentView.module.sass';
import styles from './TournamentShareMenu.module.sass';

type ShareChoice = 'link' | 'forum';

interface TournamentShareMenuProps {
  name: string;
  slug: string;
  variant: 'desktop' | 'mobile';
}

export function TournamentShareMenu({ name, slug, variant }: TournamentShareMenuProps) {
  const text = useTranslations('PublicUI.TournamentShareMenu');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<ShareChoice | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    rootRef.current?.querySelector<HTMLButtonElement>(`.${styles.option}`)?.focus();

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!copied || !open) return;
    const timeout = window.setTimeout(() => {
      setOpen(false);
      triggerRef.current?.focus();
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [copied, open]);

  const copy = async (choice: ShareChoice) => {
    const value = choice === 'link' ? getTournamentShareUrl(slug) : getTournamentForumShareCode(name, slug);
    try {
      await navigator.clipboard.writeText(value);
      setCopyFailed(false);
      setCopied(choice);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${variant === 'desktop' ? styles.desktop : styles.mobile}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className={variant === 'desktop' ? tabStyles.shareTab : tabStyles.refreshBtn}
        aria-label={text('share')}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setCopied(null);
          setCopyFailed(false);
          setOpen((current) => !current);
        }}
        disabled={!slug}
      >
        {variant === 'desktop' && text('share')}
        <ShareFatIcon aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} className={styles.menu} role="group" aria-label={text('share')}>
          <button type="button" className={styles.option} onClick={() => void copy('link')}>
            {copied === 'link' ? text('copied') : text('copyTournamentLink')}
          </button>
          <button type="button" className={styles.option} onClick={() => void copy('forum')}>
            {copied === 'forum' ? text('copied') : text('copyForumCode')}
          </button>
          {copyFailed && <p className={styles.error} role="alert">{text('copyFailed')}</p>}
        </div>
      )}
    </div>
  );
}
