import React, { useEffect, useId } from 'react';
import styles from './Modal.module.sass';
import { X } from 'phosphor-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
  showHeader?: boolean;
  modalClassName?: string;
  closeButtonClassName?: string;
  headerClassName?: string;
  contentClassName?: string;
  useContentPanel?: boolean;
  appearance?: 'grass' | 'plain';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = '600px',
  showHeader = true,
  modalClassName = '',
  closeButtonClassName = '',
  headerClassName = '',
  contentClassName = '',
  useContentPanel = true,
  appearance = 'grass',
}) => {
  const titleId = useId();
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
        <div
          className={[styles.modal, appearance === 'plain' ? styles.plain : '', modalClassName].filter(Boolean).join(' ')}
          style={{ maxWidth }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title && showHeader ? titleId : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {showHeader && (
          <div className={[styles.header, headerClassName].filter(Boolean).join(' ')}>
            {title && <h2 id={titleId} className={styles.title}>{title}</h2>}
            <button
              className={[styles.closeBtn, closeButtonClassName].filter(Boolean).join(' ')}
              onClick={onClose}
              aria-label="Close"
            >
              <X size={24} weight="bold" />
            </button>
          </div>
        )}
        <div className={[styles.content, useContentPanel ? styles.contentPanel : '', contentClassName].filter(Boolean).join(' ')}>{children}</div>
      </div>
    </div>
  );
};
