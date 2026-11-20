'use client';

import { useContext, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '../Modal/Modal';
import { FundraiserCampaign } from './FundraiserCampaign';
import { FundraiserBanner } from './FundraiserBanner';
import { FUNDRAISER_SESSION_PROMPT_KEY, FUNDRAISER_STATUS } from '../../../shared/fundraiser';
import styles from './FundraiserModal.module.sass';
import { AuthRecoveryContext } from '../Layout/AuthRecoveryContext';

export function FundraiserModal() {
  const t = useTranslations('Fundraiser');
  const recoveryActive = useContext(AuthRecoveryContext);
  const [promptOpen, setPromptOpen] = useState(false);
  const [dismissedThisVisit, setDismissedThisVisit] = useState(false);
  const [fundraiserState, setFundraiserState] = useState<{ hasSupported: boolean; authenticated: boolean } | null>(null);

  useEffect(() => {
    if (FUNDRAISER_STATUS !== 'active') return;
    const controller = new AbortController();
    void fetch('/api/app?route=fundraiser', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ hasSupported: boolean; authenticated: boolean }> : null)
      .then((state) => { if (!controller.signal.aborted) setFundraiserState(state); })
      .catch(() => { if (!controller.signal.aborted) setFundraiserState(null); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (FUNDRAISER_STATUS !== 'active' || recoveryActive || !fundraiserState?.authenticated || promptOpen || dismissedThisVisit) return;
    if (fundraiserState.hasSupported || sessionStorage.getItem(FUNDRAISER_SESSION_PROMPT_KEY) === 'true') return;
    const timer = window.setTimeout(() => {
      setPromptOpen(true);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [fundraiserState, promptOpen, dismissedThisVisit, recoveryActive]);

  if (FUNDRAISER_STATUS !== 'active') return null;
  const closePrompt = () => {
    sessionStorage.setItem(FUNDRAISER_SESSION_PROMPT_KEY, 'true');
    setPromptOpen(false);
    setDismissedThisVisit(true);
  };

  return (
    <>
      {!recoveryActive && fundraiserState?.authenticated && <FundraiserBanner onOpen={() => setPromptOpen(true)} />}
      <Modal isOpen={promptOpen && !recoveryActive && !!fundraiserState?.authenticated} onClose={closePrompt} showHeader={false}
        ariaLabel={t('title')} appearance="plain" maxWidth="680px" closeOnOverlayClick={false}
        modalClassName={styles.modalShell} contentClassName={styles.modalContent} useContentPanel={false}>
        <button type="button" className={styles.modalClose} onClick={closePrompt} aria-label={t('close')}>×</button>
        <FundraiserCampaign variant="modal" />
      </Modal>
    </>
  );
}
