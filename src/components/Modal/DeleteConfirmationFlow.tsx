import { useTranslations } from 'next-intl';
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
  const uiText = useTranslations('PublicUI.DeleteConfirmationFlow');
  const [step, setStep] = useState<ConfirmationStep>('initial');

  const cancel = () => {
    setStep('initial');
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen && step === 'initial'} onClose={cancel} title={uiText('deleteNewsPost')} maxWidth="420px">
        <p>{uiText('thinkTwiceThisCannotBeUndoneNotEvenWith')}</p>
        <div className={styles.actions}>
          <Button type="button" variant="secondaryAction" onClick={cancel}>{uiText('cancel')}</Button>
          <Button type="button" variant="primaryDanger" onClick={() => setStep('final')}>{uiText('delete')}</Button>
        </div>
      </Modal>
      <Modal isOpen={isOpen && step === 'final'} onClose={cancel} title={uiText('areYouSure')} maxWidth="420px">
        <p>{uiText('thisIsYourLastChanceToTakeItBack')}</p>
        <div className={styles.actions}>
          <Button type="button" variant="secondaryAction" onClick={cancel}>{uiText('cancel')}</Button>
          <Button type="button" variant="primaryDanger" onClick={() => setStep('ultimate')}>{uiText('delete')}</Button>
        </div>
      </Modal>
      <Modal isOpen={isOpen && step === 'ultimate'} onClose={cancel} title={uiText('final')} maxWidth="420px">
        <p>{uiText('iAmStillNotConvincedAreYouAbsolutelySure')}</p>
        <div className={styles.actions}>
          <Button type="button" variant="secondaryAction" onClick={cancel}>{uiText('cancel')}</Button>
          <Button type="button" variant="primaryDanger" onClick={() => { setStep('initial'); onConfirm(); onClose(); }}>{uiText('delete2')}</Button>
        </div>
      </Modal>
    </>
  );
};
