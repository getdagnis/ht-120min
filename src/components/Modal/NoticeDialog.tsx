import { useTranslations } from 'next-intl';
import { Button } from '../Button/Button';
import { Modal } from './Modal';

export function NoticeDialog({ message, onClose }: { message: string | null; onClose: () => void }) {
  const uiText = useTranslations('PublicUI.NoticeDialog');
  return (
    <Modal isOpen={message !== null} onClose={onClose} title={uiText('notice')} appearance="plain" maxWidth="520px">
      <p>{message}</p>
      <Button type="button" variant="primary" onClick={onClose}>{uiText('oK')}</Button>
    </Modal>
  );
}
