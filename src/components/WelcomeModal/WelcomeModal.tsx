import React from 'react';
import { X } from 'phosphor-react';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import styles from './WelcomeModal.module.sass';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPrimaryAction?: () => void;
  imageSrc: string;
  imageAlt: string;
  title: string;
  buttonLabel: string;
  children: React.ReactNode;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  onPrimaryAction,
  imageSrc,
  imageAlt,
  title,
  buttonLabel,
  children,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="720px"
      showHeader={false}
      modalClassName={styles.modal}
      contentClassName={styles.modalContent}
      useContentPanel={false}
    >
      <div className={styles.panel}>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close welcome message">
          <X size={22} weight="bold" />
        </button>

        <div className={styles.imageWrap}>
          <img src={imageSrc} alt={imageAlt} className={styles.image} />
        </div>

        <div className={styles.body}>
          <h2 className={styles.title}>{title}</h2>
          <div className={styles.copy}>{children}</div>
          <div className={styles.actions}>
            <Button type="button" variant="secondaryYellow" size="lg" onClick={onPrimaryAction ?? onClose}>
              {buttonLabel}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
