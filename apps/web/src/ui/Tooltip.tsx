import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from './cn';

export const TooltipProvider = RadixTooltip.Provider;

/**
 * A short label shown on hover and keyboard focus. It supplements a visible
 * or screen-reader name; it never carries the only name of a control.
 */
export function Tooltip({
  content,
  side = 'top',
  className,
  children,
}: {
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={8}
          className={cn(
            'z-50 rounded-sm bg-inverse px-2 py-1 text-label text-on-inverse shadow-e1',
            'data-[state=delayed-open]:animate-overlay-in',
            className,
          )}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
