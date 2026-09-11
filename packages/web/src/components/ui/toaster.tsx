'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from './use-toast';

/** Global toast renderer — mount once near the app root. */
export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
          className={cn(
            'pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border bg-white p-4 pr-8 shadow-lg motion-safe:animate-fade-in-up',
            t.variant === 'destructive'
              ? 'border-red-200'
              : t.variant === 'success'
                ? 'border-green-200'
                : 'border-gray-200',
          )}
        >
          {t.variant === 'destructive' ? (
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          ) : (
            <CheckCircle2
              className={cn(
                'h-5 w-5 shrink-0',
                t.variant === 'success' ? 'text-green-600' : 'text-brand-600',
              )}
            />
          )}
          <div className="grid gap-0.5">
            {t.title && (
              <ToastPrimitive.Title className="text-sm font-semibold text-gray-900">
                {t.title}
              </ToastPrimitive.Title>
            )}
            {t.description && (
              <ToastPrimitive.Description className="text-sm text-gray-500">
                {t.description}
              </ToastPrimitive.Description>
            )}
          </div>
          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="absolute right-2 top-2 rounded-md p-0.5 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      {/* Top-right, clear of the sticky header — avoids covering bottom-aligned action buttons. */}
      <ToastPrimitive.Viewport className="fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 pt-20 sm:max-w-sm" />
    </ToastPrimitive.Provider>
  );
}
