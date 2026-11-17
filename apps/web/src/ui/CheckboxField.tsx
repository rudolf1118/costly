import { Check } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from './cn';

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  /** One line under the label saying what checking it means. */
  hint?: ReactNode;
}

/**
 * A native checkbox with its label and hint. Native, so the keyboard, form
 * state and screen-reader support come with it; only the box is drawn.
 */
export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  function CheckboxField({ label, hint, id, className, ...props }, ref) {
    const generated = useId();
    const inputId = id ?? generated;
    const hintId = `${inputId}-hint`;

    return (
      <div className={cn('flex items-start gap-3', className)}>
        <span className="relative mt-0.5 inline-flex size-5 shrink-0">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            aria-describedby={hint ? hintId : undefined}
            className={cn(
              'peer size-5 cursor-pointer appearance-none rounded-xs border border-border-strong bg-surface',
              'transition-colors duration-100 ease-instant checked:border-accent checked:bg-accent',
              'focus-visible:shadow-[0_0_0_3px_var(--color-accent-soft-strong)] focus-visible:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
            {...props}
          />
          <Check
            aria-hidden="true"
            strokeWidth={2.5}
            className="pointer-events-none absolute inset-0.5 size-4 text-on-accent opacity-0 peer-checked:opacity-100"
          />
        </span>
        <span className="flex flex-col gap-0.5">
          <label htmlFor={inputId} className="cursor-pointer text-body-small font-medium text-text">
            {label}
          </label>
          {hint && (
            <span id={hintId} className="text-body-small text-text-secondary">
              {hint}
            </span>
          )}
        </span>
      </div>
    );
  },
);
