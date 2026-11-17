import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef, type MouseEvent } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

/** The Components board: four variants, each with hover, focus, pressed, disabled and loading. */
const button = cva(
  [
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap',
    'rounded-sm border font-medium select-none',
    'transition-colors duration-100 ease-instant',
    'disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
  ],
  {
    variants: {
      variant: {
        primary: [
          'border-transparent bg-accent text-on-accent',
          'hover:bg-accent-hover active:bg-accent-pressed',
          'disabled:bg-disabled disabled:text-on-disabled',
        ],
        secondary: [
          'border-border-strong bg-surface text-text',
          'hover:border-border-hover hover:bg-page active:bg-subtle',
          'disabled:border-border disabled:bg-surface disabled:text-on-disabled',
        ],
        ghost: [
          'border-transparent bg-transparent text-accent-text',
          'hover:bg-accent-soft active:bg-accent-soft-strong',
          'disabled:bg-transparent disabled:text-on-disabled',
        ],
        destructive: [
          'border-negative-border bg-surface text-negative',
          'hover:bg-negative-soft hover:text-negative-ink active:bg-negative-soft',
          'disabled:border-border disabled:bg-surface disabled:text-on-disabled',
        ],
      },
      size: {
        sm: 'h-8 px-3 text-body-small',
        md: 'h-10 px-4 text-body',
        lg: 'h-11 px-4 text-body',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  /**
   * Shows a spinner and ignores clicks until the work finishes. The button
   * stays focusable (`aria-disabled`, not `disabled`), so keyboard focus
   * isn't lost while a form submits.
   */
  loading?: boolean;
  /** Render the single child (such as a link) with the button's styles instead of a `<button>`. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, asChild = false, onClick, children, ...props },
  ref,
) {
  const classes = cn(button({ variant, size }), loading && 'opacity-85', className);

  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      )}
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>
        {children}
      </span>
    </button>
  );
});
