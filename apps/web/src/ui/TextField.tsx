import { CircleAlert } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from './cn';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: ReactNode;
  /** Help shown under the field while there is no error. */
  hint?: ReactNode;
  /** What is wrong and what to do. Marks the field invalid and replaces the hint. */
  error?: ReactNode;
  /** `lg` (44 px) for auth forms and touch-first layouts. */
  size?: 'md' | 'lg';
  /** Shown inside the field after the value, such as the dram sign. */
  suffix?: ReactNode;
}

/**
 * A labelled text input. The label is always visible (never a placeholder),
 * and the hint or error is tied to the input with `aria-describedby`, so a
 * screen reader reads it when the field is focused.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, size = 'md', suffix, id, className, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;
  const invalid = Boolean(error);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-body-small font-medium text-text">
        {label}
      </label>
      <div
        className={cn(
          'flex items-center gap-2 rounded-sm border bg-surface px-3',
          'transition-[border-color,box-shadow] duration-160 ease-control',
          'focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-soft-strong)]',
          invalid ? 'border-negative' : 'border-border-strong',
          props.disabled && 'bg-subtle',
          size === 'lg' ? 'h-11' : 'h-10',
        )}
      >
        <input
          ref={ref}
          id={inputId}
          aria-invalid={invalid || undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent text-body text-text outline-none',
            'placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:text-text-secondary',
            'focus-visible:outline-none',
          )}
          {...props}
        />
        {suffix && <span className="text-body text-text-secondary">{suffix}</span>}
      </div>
      {message && (
        <p
          id={messageId}
          className={cn(
            'flex items-start gap-1.5 text-body-small',
            invalid ? 'text-negative' : 'text-text-secondary',
          )}
        >
          {invalid && <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />}
          <span>{message}</span>
        </p>
      )}
    </div>
  );
});
