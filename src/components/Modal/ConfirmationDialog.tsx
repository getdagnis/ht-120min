'use client';

import { Button } from '../Button/Button';
import { Modal } from './Modal';
import type { ConfirmationOptions } from './useConfirmationDialog';
import styles from './Modal.module.sass';

export function ConfirmationDialog({ confirmation, onResolve }: {
  confirmation: ConfirmationOptions | null;
  onResolve: (accepted: boolean) => void;
}) {
  return (
    <Modal isOpen={confirmation !== null} onClose={() => onResolve(false)} title={confirmation?.title} appearance="plain">
      <p className={styles.confirmationText}>{confirmation?.message}</p>
      <div className={styles.confirmationActions}>
        <Button type="button" variant={confirmation?.destructive ? 'danger' : 'primary'} onClick={() => onResolve(true)}>
          {confirmation?.confirmLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={() => onResolve(false)}>{confirmation?.cancelLabel}</Button>
      </div>
    </Modal>
  );
}
