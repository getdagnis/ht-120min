import { useTranslations } from 'next-intl';
import React, { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import styles from './Modal.module.sass';
import { X } from 'phosphor-react';

interface ModalProps {
  isOpen: boolean;
  openLocal?: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  maxWidth?: string;
  showHeader?: boolean;
  modalClassName?: string;
  closeButtonClassName?: string;
  headerClassName?: string;
  contentClassName?: string;
  useContentPanel?: boolean;
  appearance?: 'grass' | 'plain';
  closeOnOverlayClick?: boolean;
}

const subscribeToHostname = () => () => {};
const getLocalHostname = () =>
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname.toLowerCase());
const getServerHostname = () => false;

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  openLocal = false,
  onClose,
  title,
  ariaLabel,
  children,
  maxWidth = '600px',
  showHeader = true,
  modalClassName = '',
  closeButtonClassName = '',
  headerClassName = '',
  contentClassName = '',
  useContentPanel = true,
  appearance = 'grass',
  closeOnOverlayClick = true,
}) => {
  const uiText = useTranslations('PublicUI.Modal');
  const titleId = useId();
  const isLocalHost = useSyncExternalStore(subscribeToHostname, getLocalHostname, getServerHostname);
  const [localDismissed, setLocalDismissed] = useState(false);

  const locallyForcedOpen = openLocal && isLocalHost && !localDismissed;
  const open = isOpen || locallyForcedOpen;
  const handleClose = useCallback(() => {
    if (locallyForcedOpen) setLocalDismissed(true);
    onClose();
  }, [locallyForcedOpen, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={closeOnOverlayClick ? handleClose : undefined}>
      <div
        className={[styles.modal, appearance === 'plain' ? styles.plain : '', modalClassName].filter(Boolean).join(' ')}
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={title && showHeader ? titleId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {showHeader && (
          <div className={[styles.header, headerClassName].filter(Boolean).join(' ')}>
            {title && (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            )}
            <button
              className={[styles.closeBtn, closeButtonClassName].filter(Boolean).join(' ')}
              onClick={handleClose}
              aria-label={uiText('close')}
            >
              <X size={24} weight="bold" />
            </button>
          </div>
        )}
        <div
          className={[styles.content, useContentPanel ? styles.contentPanel : '', contentClassName]
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
