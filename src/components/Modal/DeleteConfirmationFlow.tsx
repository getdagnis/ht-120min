import React, { useState } from 'react';
import { Button } from '../Button/Button';
import { Modal } from './Modal';
import styles from './DeleteConfirmationFlow.module.sass';

interface DeleteConfirmationFlowProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

type ConfirmationStep = 'initial' | 'final' | 'ultimate';

export const DeleteConfirmationFlow: React.FC<DeleteConfirmationFlowProps> = ({ isOpen, onClose, onConfirm }) => {
  const [step, setStep] = useState<ConfirmationStep>('initial');

  const cancel = () => {
    setStep('initial');
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen && step === 'initial'} onClose={cancel} title="Delete news post?" maxWidth="420px">
        <p>Think twice. This cannot be undone. Not even with access to database.</p>
        <div className={styles.actions}>
          <Button type="button" variant="secondaryAction" onClick={cancel}>Cancel</Button>
          <Button type="button" variant="primaryDanger" onClick={() => setStep('final')}>Delete</Button>
        </div>
      </Modal>
      <Modal isOpen={isOpen && step === 'final'} onClose={cancel} title="Are you sure?" maxWidth="420px">
        <p>This is your last chance to take it back.</p>
        <div className={styles.actions}>
          <Button type="button" variant="secondaryAction" onClick={cancel}>Cancel</Button>
          <Button type="button" variant="primaryDanger" onClick={() => setStep('ultimate')}>Delete</Button>
        </div>
      </Modal>
      <Modal isOpen={isOpen && step === 'ultimate'} onClose={cancel} title="Final" maxWidth="420px">
        <p>I am still not convinced. Are you absolutely sure?</p>
        <div className={styles.actions}>
          <Button type="button" variant="secondaryAction" onClick={cancel}>Cancel</Button>
          <Button type="button" variant="primaryDanger" onClick={() => { setStep('initial'); onConfirm(); onClose(); }}>Delete!</Button>
        </div>
      </Modal>
    </>
  );
};
