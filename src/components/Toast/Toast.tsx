'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './Toast.module.sass';
import { ToastContext, type ToastInput } from './useToast';

interface ToastItem extends ToastInput {
  id: string;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const closeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((toast: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    return id;
  }, []);

  const value = useMemo(() => ({ addToast, closeToast }), [addToast, closeToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastRegion toasts={toasts} onClose={closeToast} />
    </ToastContext.Provider>
  );
}

function ToastRegion({ toasts, onClose }: { toasts: ToastItem[]; onClose: (id: string) => void }) {
  return (
    <div className={styles.region} aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItemView key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
}

function ToastItemView({ toast, onClose }: { toast: ToastItem; onClose: (id: string) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onClose(toast.id), Math.max(toast.timeout ?? 5000, 5000));
    return () => window.clearTimeout(timer);
  }, [onClose, toast.id, toast.timeout]);

  return (
    <div className={styles.toast} role="status" tabIndex={0}>
      <div className={styles.title}>{toast.title}</div>
      <button type="button" className={styles.close} onClick={() => onClose(toast.id)} aria-label="Dismiss notification">
        ×
      </button>
      {toast.description && <div className={styles.description}>{toast.description}</div>}
    </div>
  );
}
