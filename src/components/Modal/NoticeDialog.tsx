import { Button } from '../Button/Button';
import { Modal } from './Modal';

export function NoticeDialog({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <Modal isOpen={message !== null} onClose={onClose} title="Notice" appearance="plain" maxWidth="520px">
      <p>{message}</p>
      <Button type="button" variant="primary" onClick={onClose}>OK</Button>
    </Modal>
  );
}
