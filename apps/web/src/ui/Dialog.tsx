import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export interface DialogContentProps {
  /** Always required: it names the dialog for screen readers. */
  title: ReactNode;
  description?: ReactNode;
  /**
   * `modal` is centred, 480 px; `drawer` slides in from the right, 440 px,
   * for add and edit forms. Below 768 px both become a sheet at the bottom.
   */
  variant?: 'modal' | 'drawer';
  children?: ReactNode;
  className?: string;
}

/**
 * A modal dialog on Radix: focus moves in and is trapped, Escape and the
 * close button dismiss it, focus returns to the trigger, and the page behind
 * is hidden from assistive technology.
 */
export function DialogContent({
  title,
  description,
  variant = 'modal',
  children,
  className,
}: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay
        className={cn(
          'fixed inset-0 z-40 bg-scrim',
          'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
        )}
      />
      <RadixDialog.Content
        // Without a description Radix warns unless this is explicitly undefined.
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'fixed z-50 flex flex-col gap-5 border-border bg-raised text-text shadow-e2 outline-none',
          // Phone: a sheet along the bottom edge.
          'inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-lg border-t p-5',
          'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
          variant === 'modal' && [
            'sm:inset-x-auto sm:top-24 sm:bottom-auto sm:left-1/2 sm:w-[min(30rem,calc(100%-2rem))]',
            'sm:-translate-x-1/2 sm:rounded-lg sm:border sm:p-6',
          ],
          variant === 'drawer' && [
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[min(27.5rem,100%)]',
            'sm:rounded-none sm:border-t-0 sm:border-l sm:p-6',
            'sm:data-[state=open]:animate-drawer-in sm:data-[state=closed]:animate-drawer-out',
          ],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <RadixDialog.Title className="text-heading-section text-text">
              {title}
            </RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="text-body text-text-secondary">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close
            aria-label="Close"
            className={cn(
              '-mt-1 -mr-2 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sm',
              'text-text-secondary transition-colors duration-100 ease-instant hover:bg-subtle hover:text-text',
            )}
          >
            <X aria-hidden="true" className="size-5" strokeWidth={1.5} />
          </RadixDialog.Close>
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
