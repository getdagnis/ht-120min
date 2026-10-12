import { useCallback, useEffect, useRef, useState } from 'react';

export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}

export function useConfirmationDialog() {
  const [confirmation, setConfirmation] = useState<ConfirmationOptions | null>(null);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);
  const resolveConfirmation = useCallback((accepted: boolean) => {
    resolver.current?.(accepted);
    resolver.current = null;
    setConfirmation(null);
  }, []);
  const confirm = useCallback((options: ConfirmationOptions) => {
    resolver.current?.(false);
    setConfirmation(options);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);
  useEffect(() => () => { resolver.current?.(false); }, []);
  return { confirmation, confirm, resolveConfirmation };
}
