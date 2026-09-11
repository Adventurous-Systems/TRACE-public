'use client';

import * as React from 'react';

export type ToastVariant = 'default' | 'success' | 'destructive';

export interface ToastItem {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

// Module-level store (shadcn-style) so `toast()` can be called from anywhere
// and the single mounted <Toaster/> renders them.
type Listener = (toasts: ToastItem[]) => void;
let store: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(store);
}

export function toast(t: Omit<ToastItem, 'id'>): string {
  const id = Math.random().toString(36).slice(2);
  store = [...store, { id, ...t }];
  emit();
  return id;
}

export function dismissToast(id: string): void {
  store = store.filter((t) => t.id !== id);
  emit();
}

export function useToast() {
  const [toasts, setToasts] = React.useState<ToastItem[]>(store);
  React.useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);
  return { toasts, toast, dismiss: dismissToast };
}
