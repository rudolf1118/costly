import * as RadixToast from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { cn } from './cn';

export interface ToastOptions {
  /** What happened, such as "Account archived". */
  title: string;
  description?: string;
  /** One follow-up, typically Undo. It must also be possible some other way. */
  action?: { label: string; onAction(): void };
}

interface ShownToast extends ToastOptions {
  id: number;
  open: boolean;
}

/** Handoff board: toasts stay 6 s. Hovering or focusing one pauses the timer. */
export const TOAST_DURATION_MS = 6000;
/** At most this many toasts at once; the oldest makes room. */
const MAX_TOASTS = 3;
/** Long enough for the exit animation before a closed toast is removed. */
const REMOVE_AFTER_MS = 400;

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

let nextId = 0;

/**
 * Brief confirmations after an action, such as "Account archived" with
 * Undo. They are announced politely, never steal focus, can be swiped away,
 * and F8 moves focus to them. Errors that need attention belong inline or
 * in a banner on the page, not in a toast that disappears.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ShownToast[]>([]);

  const show = useCallback((options: ToastOptions) => {
    const id = nextId++;
    setToasts((current) => [...current, { ...options, id, open: true }].slice(-MAX_TOASTS));
  }, []);

  const close = (id: number) => {
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, open: false } : t)));
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), REMOVE_AFTER_MS);
  };

  return (
    <RadixToast.Provider duration={TOAST_DURATION_MS} swipeDirection="down" label="Notifications">
      <ToastContext.Provider value={show}>{children}</ToastContext.Provider>
      {toasts.map((toast) => (
        <RadixToast.Root
          key={toast.id}
          type="background"
          open={toast.open}
          onOpenChange={(open) => !open && close(toast.id)}
          className={cn(
            'flex items-start gap-3 rounded-md bg-inverse py-3 pr-2 pl-4 text-on-inverse shadow-e2',
            'data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out',
            'data-[swipe=move]:translate-y-(--radix-toast-swipe-move-y) data-[swipe=end]:animate-toast-out',
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
            <RadixToast.Title className="text-body font-medium">{toast.title}</RadixToast.Title>
            {toast.description && (
              <RadixToast.Description className="text-body-small text-on-inverse-secondary">
                {toast.description}
              </RadixToast.Description>
            )}
          </div>
          {toast.action && (
            <RadixToast.Action
              altText={toast.action.label}
              onClick={toast.action.onAction}
              className="h-9 shrink-0 cursor-pointer rounded-sm px-3 text-body font-medium underline underline-offset-2 hover:bg-on-inverse/10"
            >
              {toast.action.label}
            </RadixToast.Action>
          )}
          <RadixToast.Close
            aria-label="Dismiss"
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sm text-on-inverse-secondary hover:bg-on-inverse/10 hover:text-on-inverse"
          >
            <X aria-hidden="true" strokeWidth={1.5} className="size-4" />
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport
        className={cn(
          'fixed z-50 flex flex-col gap-2 outline-none',
          // Phones: full width less 16 px each side, above the tab bar.
          'right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4',
          // Larger screens: bottom-left, at most 420 px.
          'sm:right-auto sm:bottom-6 sm:left-6 sm:w-[26.25rem]',
          'md:left-[calc(4rem+1.5rem)] lg:left-[calc(14.5rem+1.5rem)]',
        )}
      />
    </RadixToast.Provider>
  );
}

/** Shows a toast. */
export function useToast(): (options: ToastOptions) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
