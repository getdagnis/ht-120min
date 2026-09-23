import { useCallback, useState } from 'react';

export function useNoticeDialog() {
  const [notice, setNotice] = useState<string | null>(null);
  const showNotice = useCallback((message: string) => setNotice(String(message)), []);
  const closeNotice = useCallback(() => setNotice(null), []);
  return { notice, showNotice, closeNotice };
}
